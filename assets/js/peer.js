// Immediately start connecting
socket = io.connect();

console.log('Connecting Socket.io to Sails.js...');

var _setupCallbacks = false;

var _enableFirehose = false;
var _channelId = null;
var _isBroadcaster = false;

// our local peer
var _localPeerModel = null;

// object of your local peer connection from server
var _localPeerConnection = Object.create(null);

// object of your remote peer connections from server
var _remotePeerConnections = Object.create(null);

function sendOffer(peerConn) {
  var resolver = Promise.defer();

  socket.post('/peerconnection/message', { id: peerConn.id }, function gotPeerMessage(peerMessage) {
    if (peerMessage.status !== 200) {
      console.error(peerModel);
      resolver.reject(new Error('Could not message via peerconnection'));
    }

    resolver.resolve(peerMessage);
  });

  return resolver.promise;
}

function sendAnswer(peerConn) {
  var resolver = Promise.defer();

  socket.post('/peerconnection/message', { id: peerConn.id }, function gotPeerMessage(peerMessage) {
    if (peerMessage.status !== 200) {
      console.error(peerModel);
      resolver.reject(new Error('Could not message via peerconnection'));
    }

    resolver.resolve(peerMessage);
  });

  return resolver.promise;
}

function sendIceCandidates(peerConn) {
  var resolver = Promise.defer();

  socket.post('/peerconnection/message', { id: peerConn.id }, function gotPeerMessage(peerMessage) {
    if (peerMessage.status !== 200) {
      console.error(peerModel);
      resolver.reject(new Error('Could not message via peerconnection'));
    }

    resolver.resolve(peerMessage);
  });

  return resolver.promise;
}

function handleOffer(peerConn) {
  var resolver = Promise.defer();

  socket.post('/peerconnection/message', { id: peerConn.id }, function gotPeerMessage(peerMessage) {
    if (peerMessage.status !== 200) {
      console.error(peerModel);
      resolver.reject(new Error('Could not message via peerconnection'));
    }

    resolver.resolve(peerMessage);
  });

  return resolver.promise;
}

function handleAnswer(peerConn) {
  var resolver = Promise.defer();

  socket.post('/peerconnection/message', { id: peerConn.id }, function gotPeerMessage(peerMessage) {
    if (peerMessage.status !== 200) {
      console.error(peerModel);
      resolver.reject(new Error('Could not message via peerconnection'));
    }

    resolver.resolve(peerMessage);
  });

  return resolver.promise;
}

function handleIceCandidates(peerConn) {
  var resolver = Promise.defer();

  socket.post('/peerconnection/message', { id: peerConn.id }, function gotPeerMessage(peerMessage) {
    if (peerMessage.status !== 200) {
      console.error(peerModel);
      resolver.reject(new Error('Could not message via peerconnection'));
    }

    resolver.resolve(peerMessage);
  });

  return resolver.promise;
}

function makePeerConnection(peerConn) {

}

function addPeer(addedPeerConn) {
  // get the ball rolling by storing them
  _remotePeerConnections[addedPeer.id] = { model: addedPeerConn, handshake: makePeerConnection(addedPeerConn), pc: null };
}

function setupCallbacks() {
  if (_setupCallbacks) return;
  else _setupCallbacks = true;

  socket.on('peer', function gotPeerPub(message) {
    console.info('peer pubsub', message);

    switch (message.verb) {
    case 'addedTo':
      addPeerConnection(message);
      break;

    case 'removeFrom':
      removePeerConnection(message);
      break;

    default:
      console.error('unhandled peer pubsub', message.verb);
      break;
    }
  });

  socket.on('peerconnection', function gotPeerConnectionPub(message) {
    console.info('peerconnection pubsub', message);

    switch (message.verb) {
    case 'message':
      handlePeerConnectionMessage(message);
      break;

    case 'updated':
      handlePeerConnectionUpdated(message);
      break;

    default:
      console.error('unhandled peerconnection pubsub', message.verb);
      break;
    }
  });
}

function postPeer() {
  // first, we need to post as a new peer, and store it in local peer
  var step1 = function() {
    var resolver = Promise.defer();

    socket.post('/peer/create', { channel: _channelId, broadcaster: _isBroadcaster }, function gotPeerCreate(peerModel) {
      if (peerModel.status) {
	console.error(peerModel);
	resolver.reject(new Error('Could not create peer model'));
      }

      resolver.resolve(peerModel);
    });

    return resolver.promise;
  }

  // now let's create a peer connection
  var step2 = function(peerModel, peerConnection) {
    var resolver = Promise.defer();

    socket.post('/peerconnection/create', { channel: _channelId }, function gotPeerConnectionCreate(peerConnection) {
      // it's okay to have an "error" but be a broadcaster
      if (peerModel.status && !_isBroadcaster) {
        console.error(peerConnection);
        resolver.reject(new Error('Could not create peer connection'));
      }

      resolver.resolve([peerModel, peerConnection]);
    });

    return resolver.promise;
  };

  step1().then(step2)
    .spread(function(peerModel, peerConnection) {
      _localPeerModel = peerModel;
      _localPeerConnection = { model: peerModel, handshake: sendOffer(peerConnection), pc: null };

      setupCallbacks();
    })
    .error(function(err) {
      console.error('gotPeer 1', err);
    })
    .catch(function(e) {
      console.error('gotPeer 2', err);
    });
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
  // TODO can't open your own channel in multiple tabs
  if (_isBroadcaster) {
    $('#addVideo').click(function() {
      postPeer();
    });

    return;
  } else {
    postPeer();
  }

});
