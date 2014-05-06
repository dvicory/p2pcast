var _ = require('lodash');
var Promise = require('bluebird');
var io = require('sails.io.js')(require('socket.io-client'));

var RTCConnection = require('rtcpeerconnection');
var getUserMedia = require('getusermedia');
var getUserMediaAsync = Promise.promisify(getUserMedia);

global._enableFirehose = false;

// start connecting immediately
global.socket = io.connect();

Promise.promisifyAll(socket);
Promise.promisifyAll(RTCConnection.prototype);

const PeerConnectionStates = [ 'reserved', 'connecting',
                               'init_established', 'recv_established',
                               'established' ];

const getUserMediaConfig = { video: true, audio: false };

const rtcConfig = {
  debug: false,
  iceServers: [
    { url: 'stun:stun.l.google.com:19302' }
  ]
};

const rtcConstraints = {
  mandatory: {
    OfferToReceiveAudio: false,
    OfferToReceiveVideo: true
  },
  optional: [
    { RtpDataChannels: true },
    { DtlsSrtpKeyAgreement: true }
  ]
};

console.log('Connecting Socket.io to Sails.js...');

var _setupCallbacks = false;

var _channelId = null;
var _isBroadcaster = false;
var _isLive = false;

// object of your local peer and peer connection from server
var _localPeerModel = null;

// stores all peer connections
var _pcManager = new PeerConnectionManager();

var _upstream = null;

function setUpstream(stream) {
  console.info('SETTING UPSTREAM', stream);
  _upstream = stream;
}

function getUpstream() {
  return _upstream;

  console.info('SELECTING UPSTREAM', _pcManager.getRemotes());

  return _.shuffle(_.where(_pcManager.getRemotes(), { 'state': 'established' }))[0].stream;
}

function PeerConnectionManager() {
  // all peer connections
  this._peerconns = Object.create(null);
}

PeerConnectionManager.prototype.get = function get(peerConn) {
  var id = _.isObject(peerConn) ? peerConn.id : peerConn;
  return this._peerconns[id];
};

PeerConnectionManager.prototype.exists = function exists(peerConn) {
  return _.isObject(this.get(peerConn));
};

PeerConnectionManager.prototype.set = function set(peerConn) {
  if (!this.exists(peerConn)) {
    this._peerconns[peerConn.id] = peerConn;
  }

  return this.get(peerConn);
};

PeerConnection.prototype.remove = function remove(peerConn) {
  if (this.exists(peerConn)) {
    var id = _.isObject(peerConn) ? peerConn.id : peerConn;
    this._peerconns[id] = null;
    delete this._peerconns[id];
  }

  return this.get(peerConn);
};

PeerConnectionManager.prototype.getChildren = PeerConnectionManager.prototype.getLocals = function getRemotes() {
  return _.where(this._peerconns, { type: 'initiator' });
};

PeerConnectionManager.prototype.getParents = PeerConnectionManager.prototype.getRemotes = function getRemotes() {
  return _.where(this._peerconns, { type: 'receiver' });
};

function PeerConnection(socket, init) {
  // underlying webrtc peer connection
  this.pc = null;

  // underlying socket
  this.socket = socket;

  this._beenSetup = false;

  // callback for handling incoming ice candidates
  this._iceHandler = null;

  this._offerTimeout = null;
  this._queuedIce = [];

  this._dataChannels = [];

  this._group = null;

  _.defaults(this, init, {
    id: null,    // id of peer connection on server
    type: null,  // initiator or receiver?
    state: null, // current state
    model: null  // model from server, if given
  });
}

PeerConnection.createFromLocal = function createFromLocal(socket, store, init) {
  var newPc = new PeerConnection(socket, _.defaults({}, init, {
    type: 'initiator',
    state: 'reserved'
  }));

  store.set(newPc);

  return newPc._create();
};

PeerConnection.createFromRemote = function createFromRemote(socket, store, id, init) {
  var newPc = new PeerConnection(socket, _.defaults({}, init, {
    id: id,
    type: 'receiver',
    state: 'reserved'
  }));

  store.set(newPc);

  return newPc;
};

PeerConnection.prototype._create = function create() {
  var self = this;

  // TODO associate a peer connection with a specific peer
  // which will allow for multiple peers per socket
  // now let's create a peer connection
  return new Promise(function(resolve, reject) {
    socket.post('/peerconnection/create', function gotPeerConnectionCreate(peerConnection) {
      if (peerConnection.status !== 200) {
        return reject(new Error('Could not create peer connection'));
      }

      self.id = peerConnection.connection.id;
      self.type = 'initiator';
      self.state = 'reserved';
      self._group = 'pc-' + self.id;

      return resolve(self);
    });
  });
};

PeerConnection.prototype.destroy = function destroy(store) {
  var self = this;

  this.pc.releaseGroup(this._group);

  return new Promise(function(resolve, reject) {
    socket.post('/peerconnection/destroy', { id: self.id }, function gotPeerConnectionDestroy(peerConnection) {
      if (peerConnection.status !== 200) {
        return reject(new Error('Could not destroy peer connection'));
      }

      store.remove(self);

      return resolve(self);
    });
  });
};

PeerConnection.prototype.createConnection = function createConnection() {
  var self = this;

  console.log('Creating peer connection', this.id, 'isInitiator?', this.isInitiator());

  this.setupConnectionBasics();

  if (!this.isInitiator()) {
    this.createReceiverConnection();
  } else {
    this.createInitiatorConnection();
  }
};

PeerConnection.prototype.createDataConnection = function createDataConnection(name) {
  var self = this;

  var dataChannel = self.pc.createDataChannel(name);
  console.info('creating data channel (as ' + self.type + ')', dataChannel);

  dataChannel.onerror = function(error) {
    console.error('DATA CHANNEL ERROR', error);
  };

  dataChannel.onmessage = function(event) {
    console.log('GOT MESSAGE', event);

  };

  dataChannel.onopen = function() {
    dataChannel.send('HELLO FROM ' + self.type);
  };
};

PeerConnection.prototype.setupConnectionBasics = function setupConnectionBasics() {
  if (this._beenSetup) return;
  this._beenSetup = true;

  var self = this;

  this.pc = new RTCConnection(rtcConfig, rtcConstraints);

  //this.pc.on('*', function(event, data) { console.debug('debug', event, data); });

  if (!this.isInitiator())
    this.createDataConnection('heartbeat');

  this.pc.on('addStream', this._group, function(stream) { console.log('GOT STREAM', stream); });
  this.pc.on('iceConnectionStateChange', this._group, function() { self.pc.emit('processIce'); } );
  this.pc.on('signalingStateChange', this._group, function() { self.pc.emit('processIce'); } );

  // send ice when available
  this.pc.on('ice', this._group, function(candidate) {
    self.sendIce(candidate);
  });

  // process ice when available
  this._iceHandler = this.receiveMessage('ice', function(err, message) {
    var candidate = message.data.payload;

    // if we can't process it now, add it to queue
    if (!self._canProcessIce()) {
      console.info('queuing ice (as ' + self.type + ')', message.data.payload, 'from peer connection', self.id);
      self._queuedIce.push(candidate);

      self.pc.off('processIce');
      self.pc.on('processIce', self._group, self._processIceAsStable.bind(self));

      return;
    }

    console.info('processing ice immediately (as ' + self.type + ')', message.data.payload, 'from peer connection', self.id);
    try {
      self.pc.processIce(message.data.payload);
    } catch(e) {
      console.warn('unable to apply ice candidate', candidate, 'for peer connection', self.id);
    }
  });

  this.pc.on('negotiationNeeded', this._group, function() {
    console.info('renegotiating (as ' + self.type + ') for peer connection', self.id);
    clearTimeout(self._offerTimeout);
    self._offerTimeout = setTimeout(self._negotiateAsStable.bind(self), 50);
  });

  this._offerHandler = this.receiveMessage('offer', function(err, message) {
    console.info('receiving offer (as ' + self.type + ')', message.data.payload, 'from peer connection', self.id);
    self.pc.handleOfferAsync(message.data.payload)
      .then(function() {
        return self.pc.answerAsync(rtcConstraints);
      })
      .then(function(answer) {
        console.info('sending answer (as ' + self.type + ')', answer, 'to peer connection', self.id);
        return self.sendAnswer(answer);
      })
      .then(function() {
        return self.finalize();
      })
      .then(function(peerFinalization) {
        self.state = peerFinalization.state;
        console.info('setting state (as ' + self.type + ') to', self.state, 'for peer connection', self.id);
      });
  });

  this._answerHandler = this.receiveMessageAsync('answer', function(err, message) {
    console.info('receiving answer (as ' + self.type + ')', message.data.payload, 'from peer connection', self.id);
    self.pc.handleAnswerAsync(message.data.payload)
      .then(function() {
        return self.finalize();
      })
      .then(function(peerFinalization) {
        self.state = peerFinalization.state;
        console.info('setting state (as ' + self.type + ') to', self.state, 'for peer connection', self.id);
      });
  });

  this.pc.on('addChannel', this._group, this._onAddChannel.bind(this));
};

PeerConnection.prototype.createInitiatorConnection = function createInitiatorConnection() {
  return;
};

PeerConnection.prototype.createReceiverConnection = function createReceiverConnection() {
  //return this._negotiateAsStable();
};

// http://dev.w3.org/2011/webrtc/editor/webrtc.html#state-definitions
// https://github.com/rtc-io/rtc/issues/12
PeerConnection.prototype._isStable = function _isStable() {
  return this.pc.signalingState === 'stable';
};

PeerConnection.prototype._canProcessIce = function _canProcessIce() {
  return this._isStable() && this.pc.remoteDescription;
};

PeerConnection.prototype._processIceAsStable = function _processIceAsStable() {
  var self = this;

  if (this._canProcessIce()) {
    this.pc.off('processIce', this._processIceAsStable);

    this._queuedIce = _.filter(this._queuedIce, function(candidate) {
      try {
        console.info('processing queued ice (as ' + self.type + ')', candidate, 'from peer connection', self.id);
        self.pc.processIce(candidate);
        return false;
      } catch(e) {
        console.warn('unable to apply ice candidate', candidate, 'for peer connection', self.id);
        return true;
      }
    });
  }
};

PeerConnection.prototype._negotiateAsStable = function _negotiateAsStable() {
  var self = this;

  if (!this._isStable()) return false;

  return this.pc.offerAsync(rtcConstraints)
    .then(function(offer) {
      console.info('sending offer (as ' + self.type + ')', offer, 'to peer connection', self.id);
      console.info(self.pc);
      self.sendOffer(offer);
    });
};

PeerConnection.prototype._onAddChannel = function(newChannel) {
  var self = this;

  this._dataChannels.push(newChannel);

  console.info('got new data channel (as ' + self.type + ')', newChannel);

  newChannel.onerror = function(error) {
    console.error('DATA CHANNEL ERROR', error);
  };

  newChannel.onmessage = function(event) {
    console.log('GOT MESSAGE', event);
  };

  newChannel.onopen = function() {
    newChannel.send('HELLO FROM ' + self.type);
  };
};

PeerConnection.prototype.finalize = function finalize() {
  var self = this;

  return new Promise(function(resolve, reject) {
    socket.post('/peerconnection/finalize', { id: self.id }, function gotPeerFinalize(peerFinalization) {
      if (peerFinalization.status !== 200) {
        return reject(new Error('Could not finalize peer connection'));
      }

      return resolve(peerFinalization);
    });
  });
};

PeerConnection.prototype.isInitiator = function isInitiator() {
  return this.type === 'initiator';
};

PeerConnection.prototype.receiveOneMessage = function receiveOneMessage(type) {
  var self = this;
  var cb;

  var handleMessage = function handleMessage(err, message, resolve, reject) {
    socket.removeListener('peerconnection', cb);
    return resolve(message);
  };
  3
  return new Promise(function(resolve, reject) {
    cb = self.receiveMessage(type, _.partialRight(handleMessage, resolve, reject));
  });
};

PeerConnection.prototype.receiveMessage = function receiveMessages(type, cb) {
  var self = this;

  var handleMessage = function handleMessage(message, resolve, reject) {
    if (message.verb === 'messaged' && message.id === self.id && message.data.type === type) {
      cb(null, message);
    }
  };

  socket.on('peerconnection', handleMessage);

  return handleMessage;
};

PeerConnection.prototype.receiveMessageAsync = Promise.promisify(PeerConnection.prototype.receiveMessage);

PeerConnection.prototype.sendMessage = function sendMessage(type, payload) {
  var self = this;

  return new Promise(function(resolve, reject) {
    socket.post('/peerconnection/message', { id: self.id, data: { type: type, payload: payload } }, function gotPeerMessage(peerMessage) {
      if (peerMessage.status !== 200) {
        return reject(new Error('Could not message', { type: type, payload: payload }, 'via peer connection', self.id));
      }

      return resolve(peerMessage);
    });
  });
};

PeerConnection.prototype.sendIce = function sendIce(candidate) {
  return this.sendMessage('ice', candidate)
    .then(function(peerMessage) {
      return peerMessage;
    });
};

PeerConnection.prototype.sendOffer = function sendOffer(offer) {
  var self = this;

  return this.sendMessage('offer', offer)
    .then(function(peerMessage) {
      self.state = 'connecting';
      return peerMessage;
    });
};

PeerConnection.prototype.sendAnswer = function sendAnswer(answer) {
  return this.sendMessage('answer', answer)
    .then(function(peerMessage) {
      return peerMessage;
    });
};

function addRemotePeerConnection(addedPeerConn) {
  if (_pcManager.exists(addedPeerConn)) return;

  var newPc = PeerConnection.createFromRemote(socket, _pcManager, addedPeerConn);
  newPc.createConnection();

  var upstream = getUpstream();
  console.info('got upstream', upstream, 'for remote peer connection', newPc.id);
  newPc.pc.addStream(upstream);
}

function removeRemotePeerConnection(removedPeerConn) {
  if (!_pcManager.exists(removedPeerConn)) return;

  if (_pcManager.exists(removedPeerConn)) {
    var pc = _pcManager.get(removedPeerConn);
    pc.destroy(_pcManager);
  }
}

function setupCallbacks() {
  if (_setupCallbacks) return;
  else _setupCallbacks = true;

  socket.on('peer', function gotPeerPub(message) {
    console.info('peer pubsub', message);

    if (!_localPeerModel) return;

    switch (message.verb) {
    case 'addedTo':
      if (message.id === _localPeerModel.id
          && message.attribute === 'connections') {
        addRemotePeerConnection(message.addedId);
      }
      break;

    case 'removedFrom':
      if (message.id === _localPeerModel.id
          && message.attribute === 'connections') {
        removeRemotePeerConnection(message.removedId);
      }
      break;

    default:
      console.info('unhandled peer pubsub', message.verb);
      break;
    }
  });

  socket.on('peerconnection', function gotPeerConnectionPub(message) {
    console.info('peerconnection pubsub', message);

    switch (message.verb) {
    case 'message':
      //handlePeerConnectionMessage(message);
      break;

    case 'updated':
      if (_pcManager.exists(message) && message.data.state) {
        _pcManager.get(message).state = message.data.state;
        //handlePeerConnectionUpdated(message);
      }
      break;

    default:
      console.info('unhandled peerconnection pubsub', message.verb);
      break;
    }
  });
}

function postPeer() {
  // first, we need to post as a new peer, and store it in local peer
  var step1 = function(channelId, isBroadcaster) {
    return new Promise(function(resolve, reject) {
      socket.post('/peer/create', { channel: channelId, broadcaster: isBroadcaster }, function gotPeerCreate(peerModel) {
        if (!peerModel.id) {
          return reject(new Error('Could not create peer model'));
        }

        return resolve(peerModel);
      });
    });
  };

  step1(_channelId, _isBroadcaster)
    .then(function(peerModel) {
      setupCallbacks();

      _localPeerModel = peerModel;
      return PeerConnection.createFromLocal(socket, _pcManager, { model: peerModel });
    })
    .then(function(localPeerConn) {
      console.info('created local peer connection', localPeerConn.id,
                   'in store?', _pcManager.exists(localPeerConn),
                   'type?', localPeerConn.type);
      localPeerConn.createConnection();
    })
    .error(function(err) {
      console.error('postPeer error', err);
    })
    .catch(function(e) {
      console.error('postPeer catch', e);
    });
}

function createOrGetPeer(channelId, isBroadcaster) {
  return new Promise(function(resolve, reject) {
    socket.post('/peer/create', { channel: channelId, broadcaster: isBroadcaster }, function gotPeerCreate(peerModel) {
      if (!peerModel.id) {
        return reject(new Error('Could not create peer model'));
      }

      return resolve(peerModel);
    });
  });
}

function createLocalPeerConnection(socket, manager, peerModel) {
  return PeerConnection.createFromLocal(socket, manager, { model: peerModel })
    .then(function(peerConn) {
      peerConn.createConnection();
      return peerConn;
    });
}

function injectUserMedia(peerConn) {
  return getUserMediaAsync(getUserMediaConfig)
    .then(function(stream) {
      return [stream, peerConn];
    });
}

function addStream(stream, peerConn) {
  peerConn.pc.addStream(stream);
}

// Attach a listener which fires when a connection is established:
socket.on('connect', function socketConnected() {
  console.log(
    'Socket is now connected and globally accessible as `socket`.\n' +
      'e.g. to send a GET request to Sails via Socket.io, try: \n' +
      '`socket.get("/foo", function (response) { console.log(response); })`'
  );

  // Sends a request to a built-in, development-only route which which
  // subscribes this socket to the firehose, a channel which reports
  // all messages published on your Sails models on the backend, i.e.
  // publishUpdate(), publishDestroy(), publishAdd(), publishRemove(),
  // and publishCreate().
  //
  // Note that these messages are received WHETHER OR
  // NOT the current socket is actually subscribed to them.  The firehose
  // is useful for debugging your app's pubsub workflow-- it should never be
  // used in your actual app.
  socket.get('/firehose', function nowListeningToFirehose () {
    // Attach a listener which fires every time Sails publishes
    // message to the firehose.
    socket.on('firehose', function newMessageFromSails ( message ) {
      if (_enableFirehose) console.log('FIREHOSE (debug): Sails published a message ::\n', message);
    });
  });

  if ($('#currentChannelId').length) {
    _channelId = parseInt($('#currentChannelId').text());
  }

  // we're only interested if we're on a channel
  if (!_channelId) return;

  // we're a broadcaster if this is here
  if ($('#addVideo').length) _isBroadcaster = true;

  // are we live?
  if ($('#liveness').data('status') === 'live') _isLive = true;
  else _isLive = false;

  // if we're a broadcaster we're not interested in continuing at this point
  // we'll come back later to add video
  // TODO can't open your own channel in multiple tabs
  setupCallbacks();

  if (_isBroadcaster) {
    $('#addVideo').click(function() {
      createOrGetPeer(_channelId, _isBroadcaster)
        .then(function(peerModel) {
          _localPeerModel = peerModel;
          return [peerModel, getUserMediaAsync(getUserMediaConfig)];
        })
        .spread(function(peerModel, stream) {
          peerModel.stream = stream;
          setUpstream(stream);
          $('#localVideo')[0].src = URL.createObjectURL(stream);
        })
        .error(function(err) {
          console.error(err);
        });
    });

    return;
  } else {
    createOrGetPeer(_channelId, _isBroadcaster)
      .then(function(peerModel) {
        _localPeerModel = peerModel;
        return createLocalPeerConnection(socket, _pcManager, peerModel);
      })
      .then(function(peerConn) {
        peerConn.pc.on('addStream', function(event) {
          /*
           _.forEach(_pcManager.getRemotes(), function(pc) {
           pc.pc.addStream(event.stream);
           });
           */
          setUpstream(event.stream);
          $('#localVideo')[0].src = URL.createObjectURL(event.stream);
        });
      });
  }

});
