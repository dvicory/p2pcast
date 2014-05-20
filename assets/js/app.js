var _ = require('lodash');
var Promise = require('bluebird');
var io = require('sails.io.js')(require('socket.io-client'));

var getUserMedia = require('getusermedia');
var getUserMediaAsync = Promise.promisify(getUserMedia);

var PeerConnectionManager = require('./PeerConnectionManager');
var PeerConnection = require('./PeerConnection');

global._enableFirehose = false;

// start connecting immediately
var socket = io.connect();
global.socket = socket;

// and promisify...
Promise.promisifyAll(socket);

const getUserMediaConfig = { video: true, audio: false };

console.log('Connecting Socket.io to Sails.js...');

var _setupCallbacks = false;

var _channelId = null;
var _isBroadcaster = false;
var _isLive = undefined;

// object of your local peer and peer connection from server
var _localPeerModel = null;

// stores all peer connections
var _pcManager = new PeerConnectionManager();
global._pcManager = _pcManager;

var _upstream = null;

function setUpstream(stream) {
  console.info('SETTING UPSTREAM', stream);
  _upstream = stream;
}

function getUpstream() {
  return _upstream;

  console.info('SELECTING UPSTREAM', _pcManager.getRemotes());

  return _.shuffle(_.where(_pcManager.getParents(), { 'state': 'established' }))[0].stream;
}

function addRemotePeerConnection(addedPeerConn) {
  if (_pcManager.exists(addedPeerConn)) return;

  PeerConnection.createRemote(socket, addedPeerConn)
    .then(function(newPc) {
      _pcManager.set(newPc);
      newPc.startConnection();

      var upstream = getUpstream();
      console.info('got upstream', upstream, 'for remote peer connection', newPc.id);
      newPc.pc.addStream(upstream);
    });
}

function removeRemotePeerConnection(removedPeerConn) {
  console.info('removing remote peer conn', removedPeerConn);

  if (_pcManager.exists(removedPeerConn)) {
    var pc = _pcManager.get(removedPeerConn);
    pc.destroy();

    _pcManager.remove(removedPeerConn);
  }

  // we have no more upstream!
  if (_pcManager.getParents().length === 0 && _localPeerModel) {
    console.info('handling reconnect');

    return createLocalPeerConnection(socket, _pcManager, _localPeerModel)
      .then(function(peerConn) {
        peerConn.pc.on('addStream', function(event) {
          setUpstream(event.stream);
          $('#localVideo')[0].src = URL.createObjectURL(event.stream);
        });
      })
      .error(function(err) {
        console.error('error in bootstrapping', err);
      })
      .catch(function(err) {
        console.error('throw in bootstrapping', err);
      });
  }
}

function handleChannelMessage(data) {
  if (data.type === 'status') {
    console.info('got channel status', data);

    // update number of peers
    if (data.numPeers) $('#peers').text(data.numPeers);

    // do we got live data?
    if (_.has(data, 'live')) {
      // if we were previously not live (like at start)
      // or was offline, we should figure out how to deal with it
      if (!_isLive) {
        // so if we are now live, awesome
        // we'll become a peer right away
        if (data.live) {
          createOrGetPeer(_channelId, false)
            .then(function(peerModel) {
              _localPeerModel = peerModel;
              return createLocalPeerConnection(socket, _pcManager, peerModel);
            })
            .then(function(peerConn) {
              peerConn.pc.on('addStream', function(event) {
                setUpstream(event.stream);
                $('#localVideo')[0].src = URL.createObjectURL(event.stream);
              });
            })
            .error(function(err) {
              console.error('error in bootstrapping', err);
            })
            .catch(function(err) {
              console.error('throw in bootstrapping', err);
            });
        } else if (_isBroadcaster && !data.live) {
          // so if we are not live and are a broadcaster, give the user a chance to become one
          // we'll do this by disabling the addVideo button and handling a click
          $('#addVideo').removeAttr('disabled');

          $('#addVideo').one('click', function() {
            getUserMediaAsync(getUserMediaConfig)
              .then(function(stream) {
                _isLive = true; // very important
                return [createOrGetPeer(_channelId, _isBroadcaster), stream];
              })
              .spread(function(peerModel, stream) {
                _localPeerModel = peerModel;
                _localPeerModel.stream = stream;
                setUpstream(stream);
                $('#localVideo')[0].src = URL.createObjectURL(stream);
              })
              .error(function(err) {
                console.error('error in bootstrapping', err);
              })
              .catch(function(err) {
                console.error('throw in bootstrapping', err);
              });
          });
        }
      }

      // update indicator
      if (data.live) {
        $('#liveness-indicator')
          .text('live')
          .removeClass('palette-asbestos')
          .addClass('palette-alizarin');
      } else {
        $('#liveness-indicator')
          .text('offline')
          .removeClass('palette-alizarin')
          .addClass('palette-asbestos');
      }

      // finally update our global live tracker
      _isLive = data.live;
    }
  } else {
    console.info('unknown channel message', data);
  }
}

function setupCallbacks() {
  if (_setupCallbacks) return;
  else _setupCallbacks = true;

  socket.post('/channel/subscribe', { id: _channelId }, function gotChannelSubscribe(resp) {
    console.info('got channel subscription', resp);
  });

  socket.on('channel', function gotChannelPub(message) {
    console.info('channel pubsub', message);

    switch (message.verb) {
    case 'messaged':
      handleChannelMessage(message.data);
      break;

    default:
      console.info('unhandled channel pubsub', message.verb);
      break;
    }
  });

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
      return PeerConnection.createLocal(socket, _pcManager, { model: peerModel });
    })
    .then(function(localPeerConn) {
      console.info('created local peer connection', localPeerConn.id,
                   'in store?', _pcManager.exists(localPeerConn),
                   'type?', localPeerConn.type);
      localPeerConn.startConnection();
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
  return PeerConnection.createLocal(socket, { model: peerModel })
    .then(function(peerConn) {
      manager.set(peerConn);
      peerConn.startConnection();
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

  // if we're a broadcaster we're not interested in continuing at this point
  // we'll come back later to add video
  setupCallbacks();
});
