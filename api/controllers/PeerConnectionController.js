/**
 * PeerConnectionController.js
 *
 * @description ::
 * @docs        :: http://sailsjs.org/#!documentation/controllers
 */

var Promise = require('bluebird');

module.exports = {
  create: function(req, res) {
    if (!req.isSocket) {
      return res.badRequest('Peer management only supported with sockets');
    }

    var socketId = req.socket.id;
    var initiatorPeerId;

    // first, we get the id of the one requesting a new peer connection
    // to do this, we find them in the peer table
    var step1 = function(socketId) {
      var resolver = Promise.defer();

      Peer.findOneBySocketID(socketId)
	.populate('channel')
	.populate('parent')
	.populate('children')
        .exec(function(err, peer) {
          if (err) resolver.reject(err);

          if (!peer) {
            resolver.reject(new Error('Can not get a peer connection unless you are a peer'));
          }

          resolver.resolve(peer);
        });

      return resolver.promise;
    };
    //var step1 = Peer.getPeerBySocketId;

    // second, we now have the initiator id
    // we will then select a peer for them
    // TODO more complicated logic, duh
    var step2 = function(initiatorPeer) {
      sails.log.info('step2 initiator', initiatorPeer);

      var resolver = Promise.defer();

      Peer.find()
	.where({ channel: initiatorPeer.channel.id })
	.populate('channel')
	.populate('parent')
	.populate('children')
        .exec(function(err, peers) {
          if (err) resolver.reject(err);

          if (!peers) {
            resolver.reject(new Error('No peer connections available'));
	  }

	  // TODO more hacks
	  // if a broadcaster wants a peer connection, that represents his camera "peer connection"
	  // this presents a dilemna, do we return them a peer connection?
	  // do we instead return them something special?

	  // only choose peers that can rebroadcast
	  // also, don't choose yourself
	  sails.log.info('peers', peers);

	  peers = _.filter(peers, function(peer) {
	    sails.log.info('canRebroadcast', peer.canRebroadcast(), 'peer.id', peer.id, 'initiatorPeer.id', initiatorPeer.id);
	    return peer.canRebroadcast() && peer.id !== initiatorPeer.id;
	  });

	  sails.log.info('peers2 narrowed to', peers);

	  // now choose the one with the min number of children
	  // but add some randomness
	  var receiverPeer = _.min(_.shuffle(peers), function(peer) {
	    return peer.children.length;
	  });

          if (receiverPeer === Infinity) {
	    resolver.reject(new Error('No peer connections available'));
          }

	  sails.log.info('step2 receiverPeer', receiverPeer);

          resolver.resolve([initiatorPeer, receiverPeer]);
        });

      return resolver.promise;
    };

    // finally, we will use that to hook them up together
    var step3 = function(initiatorPeer, receiverPeer) {
      sails.log.info('step3 receiver', receiverPeer);

      var resolver = Promise.defer();

      // TODO bad hack
      // use .spread()?
      // problem is we need to get two values from the last resolve, but resolve can only pass a single one
      //var initiatorPeer = peerPair[0];
      //var receiverPeer = peerPair[1];

      PeerConnection.create({ state: 'reserved', initiator: initiatorPeer.id, receiver: receiverPeer.id })
	.exec(function(err, peerConn) {
	  if (err) resolver.reject(err);

	  if (!peerConn) {
	    resolver.reject(new Error('Unable to create peer connection'));
	  }

	  // subscribe peer connection to socket
	  PeerConnection.subscribe(req.socket, peerConn);

	  sails.log.info('PeerConnection#create step3: Creating peer connection', peerConn.id, 'for initiator', peerConn.initiator, 'and receiver', peerConn.receiver);

	  resolver.resolve([peerConn, initiatorPeer, receiverPeer]);
	});

      return resolver.promise;
    };

    var saveChildren = function(peerConn, initiatorPeer, receiverPeer) {
      var resolver = Promise.defer();

      var previousReceiver = receiverPeer.toObject();

      receiverPeer.children.add(peerConn.id);
      receiverPeer.save(function(err) {
	if (err) resolver.reject(err);

	sails.log.info('PeerConnection#create: Publishing add to receiver id', receiverPeer.id, 'about peer connection', peerConn.id);
	Peer.publishAdd(receiverPeer.id, 'children', peerConn.id, req.socket, { previous : previousReceiver });
	resolver.resolve([peerConn, initiatorPeer, receiverPeer]);
      });

      return resolver.promise;
    };

    var saveParent = function(peerConn, initiatorPeer, receiverPeer) {
      var resolver = Promise.defer();

      var previousInitiator = initiatorPeer.toObject();

      /*
      initiatorPeer.parent = peerConn.id;
      initiatorPeer.save(function(err) {
	if (err) resolver.reject(err);

        sails.log.info('PeerConnection#create: Publishing update about initiator id', initiatorPeer.id, 'with parent', initiatorPeer.parent.id, 'about peer connection', peerConn.id);
	Peer.publishUpdate(initiatorPeer.id, { parent: peerConn.id }, req.socket, { previous: previousInitiator });
	resolver.resolve([peerConn, initiatorPeer, receiverPeer]);
      });
      */
      /*
      Peer.update(initiatorPeer.id, { parent: peerConn.id })
	.exec(function(err, updated) {
	  if (err) resolver.reject(err);

	  updated = updated[0];

          sails.log.info('PeerConnection#create: Publishing update about initiator', updated.id, 'with parent conn', updated.parent, 'and parent peer', receiverPeer.id);
          Peer.publishUpdate(updated.id, { parent: updated.parent }, req.socket, { previous: previousInitiator });
          resolver.resolve([peerConn, initiatorPeer, receiverPeer]);
	});
      */

      resolver.resolve([peerConn, initiatorPeer, receiverPeer]);

      return resolver.promise;
    };

    step1(socketId).then(step2).spread(step3).spread(saveChildren).spread(saveParent)
      .spread(function(peerConn, initiator, receiver) {
        return res.send(peerConn);
      })
      .error(function(err) {
        sails.log.error('PeerConnection#create: Socket', socketId, 'requested peer;', err.message);
        return res.json({ status: 404, message: err.message });
      })
      .catch(function(e) {
        sails.log.error(e);
        return res.serverError('Internal server error');
      });

    /*
    step1(socketId).then(step2).spread(step3)
      .spread(function(peerConn, initiator, receiver) {
	// now let's subscribe the sockets to this peer connection
	initiator.parent.add(receiver);
	receiver.children.add(initiator);

	sails.log.info('peerConn', peerConn, 'initiator', initiator, 'receiver', receiver);

	return res.send(peerConn);
      })
      .error(function(err) {
	sails.log.error('PeerConnection#create: Socket', socketId, 'requested peer;', err.message);
	return res.json({ status: 404, message: err.message });
      })
      .catch(function(e) {
	sails.log.error(e);
	return res.serverError('Internal server error');
      });
    */
  },

  message: function(req, res) {
    if (!req.isSocket) {
      return res.badRequest('Peer management only supported with sockets');
    }

    var peerConnectionId = req.param('id');
    var payload = req.param('payload');
    var socketId = req.socket.id;

    var step1 = function(peerConnectionId) {
      sails.log.info('PeerConnection#message: step1', peerConnectionId);

      var resolver = Promise.defer();

      PeerConnection.findOneById(peerConnectionId)
	.populate('initiator')
	.populate('receiver')
	.exec(function(err, peerConn) {
	  if (err) resolver.reject(err);

	  if (!peerConn) {
	    resolver.reject(new Error('Can not message a nonexistent peer connection'));
	  }

	  resolver.resolve(peerConn);
	});

      return resolver.promise;
    };

    // update reserved state to connecting state as required
    var updateState = function(peerConn) {
      sails.log.info('PeerConnection#message: step2', peerConn);

      var resolver = Promise.defer();

      if (peerConn.state === 'reserved') {
	var previousPeerConn = peerConn.toObject();

	PeerConnection.update({ id: peerConn.id }, { state: 'connecting' })
          .exec(function(err, updated) {
            if (err) resolver.reject(err);

	    updated = updated[0];

            if (!updated) {
              resolver.reject(new Error('Could not change nonexistent peer connection state'));
            }

	    // publish update if needed
	    sails.log.info('PeerConnection#message: updateState for peer connection id', updated.id, 'new state', updated.state, 'previous', peerConn);
	    PeerConnection.publishUpdate(updated.id, { state: updated.state }, null, { previous: peerConn });

            resolver.resolve(peerConn);
          });
      } else {
	// some other state
	resolver.resolve(peerConn);
      }

      return resolver.promise;
    };

    step1(peerConnectionId).then(updateState)
      .then(function(peerConn) {
	// we'll subscribe them to the peer connection
	// this is *especially* needed after a peer connection is first initiated
	// the remote peer knows they they were added as one of their children, but can't be subscribed
	// it is the remote peer's responsibility to make an offer using message
	// this will, in effect, subscribe them to the future of the channel

	sails.log.info('PeerConnection#message: Subscribing socket', socketId, 'to peer connection', peerConn.id);
	PeerConnection.subscribe(req.socket, peerConn);

	// now we'll forward the message on, exclude the sender
	PeerConnection.message(peerConn, payload, req.socket);

	// let our guy know all is well
	return res.json({ status: 200 });
      })
      .error(function(err) {
        sails.log.error('PeerConnection#message: Socket', socketId, 'tried to message with peer connection;', err.message);
        return res.json({ status: 404, message: err.message });
      })
      .catch(function(e) {
        sails.log.error(e);
        return res.serverError('Internal server error');
      });
  },

  destroy: function(req, res) {
    if (!req.isSocket) {
      return res.badRequest('Peer management only supported with sockets');
    }

    var peerConnectionId = req.param('id');
    var socketId = req.socket.id;

    var step1 = function(peerConnectionId) {
      sails.log.info('PeerConnection#destroy: step1', peerConnectionId);

      var resolver = Promise.defer();

      PeerConnection.findOneById(peerConnectionId)
        .populate('initiator')
        .populate('receiver')
        .exec(function(err, peerConn) {
          if (err) resolver.reject(err);

          if (!peerConn) {
            resolver.reject(new Error('Can not destroy  nonexistent peer connection'));
          }

          resolver.resolve(peerConn);
        });

      return resolver.promise;
    };

    var step2 = function(peerConn) {
      sails.log.info('PeerConnection#destroy: step2', peerConn);

      var resolver = Promise.defer();

      PeerConnection.destroy({ id: peerConn.id })
        .exec(function(err) {
          if (err) resolver.reject(err);

          resolver.resolve(peerConn);
        });

      return resolver.promise;
    };

    step1(peerConnectionId).then(step2)
      .then(function(peerConn) {
	sails.log.info('PeerConnection#message: Destroying peer connection', peerConn.id, 'by request of socket', socketId);

	// publish the destroy
	PeerConnection.publishDestroy(peerConn.id, null, { previous: peerConn });

	return res.json({ status: 200 });
      })
      .error(function(err) {
        sails.log.error('PeerConnection#destroy: Socket', socketId, 'tried to destroy a peer connection;', err.message);
        return res.json({ status: 404, message: err.message });
      })
      .catch(function(e) {
        sails.log.error(e);
        return res.serverError('Internal server error');
      });

  },

  finalize: function(req, res) {
    if (!req.isSocket) {
      return res.badRequest('Peer management only supported with sockets');
    }

    var peerConnectionId = req.param('id');
    var socketId = req.socket.id;

    var step1 = function(peerConnectionId) {
      sails.log.info('PeerConnection#finalize: step1', peerConnectionId);

      var resolver = Promise.defer();

      PeerConnection.findOneById(peerConnectionId)
        .populate('initiator')
        .populate('receiver')
        .exec(function(err, peerConn) {
          if (err) resolver.reject(err);

          if (!peerConn) {
            resolver.reject(new Error('Can not finalize a nonexistent peer connection'));
          }

          resolver.resolve(peerConn);
        });

      return resolver.promise;
    };

    // update reserved state to connecting state as required
    var updateState = function(peerConn) {
      sails.log.info('PeerConnection#finalize: step2', peerConn);

      var resolver = Promise.defer();

      if (peerConn.state !== 'established') {
	var newState = 'established';

	if (peerConn.receiver.socketID === socketId) {
	  if (peerConn.state !== 'init_established') newState = 'recv_' + newState;
	} else if (peerConn.initiator.socketID === socketId) {
	  if (peerConn.state !== 'recv_established') newState = 'init_' + newState;
	} else {
	  // WTF?
	  resolver.reject(new Error('Neither the receiver or initiator peer were responsible for finalizing the peer connection'));
	}

	sails.log.info('PeerConnection#finalize: step2 updating peer connection', peerConn.id, 'with new state', newState, 'from old state', peerConn.state);

        PeerConnection.update({ id: peerConn.id }, { state: newState })
          .exec(function(err, updated) {
            if (err) resolver.reject(err);

            if (!updated || updated.length === 0) {
              resolver.reject(new Error('Could not change nonexistent peer connection state'));
            }

	    updated = updated[0];

            // publish update
            sails.log.info('PeerConnection#finalize: updateState for peer connection id', updated.id, 'new state', updated.state, 'previous', peerConn);
            PeerConnection.publishUpdate(updated.id, { state: updated.state }, null, { previous: peerConn });

            resolver.resolve(peerConn);
          });
      } else {
	// already in established state
        resolver.resolve(peerConn);
      }

      return resolver.promise;
    };

    step1(peerConnectionId).then(updateState)
      .then(function(peerConn) {
        sails.log.info('PeerConnection#message: Finalizing peer connection', peerConn.id, 'into state', peerConn.state, 'by request of socket', socketId);

        return res.json({ status: 200 });
      })
      .error(function(err) {
        sails.log.error('PeerConnection#destroy: Socket', socketId, 'tried to finalize a peer connection;', err.message);
        return res.json({ status: 404, message: err.message });
      })
      .catch(function(e) {
        sails.log.error(e);
        return res.serverError('Internal server error');
      });

  }

};
