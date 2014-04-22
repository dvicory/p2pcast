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

    // first, we get the id of the one requesting a new peer connection
    // to do this, we find them in the peer table
    var getPeerBySocketId = Promise.method(function(socketId) {
      return Peer.findOneBySocketId(socketId)
        .populate('channel')
        .populate('connections')
        .then(function(peer) {
          if (!peer) {
            return Promise.reject(res.notFound('Can not get a peer connection unless you are a peer'));
          }

          return peer;
        });
    });

    // second, we now have the initiator id
    // we will then select a peer for them
    var getPeerMatch = function(initiatorPeer) {
      sails.log.info('step2 initiator', initiatorPeer);

      return Peer.find()
        .where({ channel: initiatorPeer.channel.id })
        .populate('connections')
        .then(function(peers) {
          if (!peers || peers.length === 0) {
            sails.log.error('step2 no peers', peers);
            return Promise.reject(res.notFound('No peer connections found'));
          }

          // only choose peers that can rebroadcast
          // also, don't choose yourself
          sails.log.info('peer match initial candidates', peers);

          peers = _.filter(peers, function(peer) {
            sails.log.info('peer.id', peer.id, 'canRebroadcast', peer.canRebroadcast(),
              'initiatorPeer.id', initiatorPeer.id);
            return peer.canRebroadcast() && peer.id !== initiatorPeer.id;
          });

          sails.log.info('peers narrowed to', peers);

          // now choose the one with the min number of children
          // but add some randomness
          /*
          var receiverPeer = _.min(_.shuffle(peers), function(peer) {
            console.log('peer.id outbound length', peer.outbound.length);
            return peer.outbound.length;
          });
          */

          var receiverPeer = _.min(_.shuffle(peers), function(peer) {
            console.log('peer.id connections length', peer.connections.length);
            return peer.getChildrenConnections().length;
          });

          if (receiverPeer === Infinity) {
            return Promise.reject(res.notFound('No peer connections available'));
          }

          sails.log.info('candidate peer is', receiverPeer);

          return [initiatorPeer, receiverPeer];
        });
    };

    // finally, we will use that to hook them up together
    var hookupPeerConnection = function(initiatorPeer, receiverPeer) {
      sails.log.info('step3 initiator', initiatorPeer, 'receiver', receiverPeer);

      var makePc = Promise.method(function(receiverPeer) {
        return PeerConnection.create({ state: 'reserved', endpoint: receiverPeer.id, initiator: initiatorPeer.id })
          .then(function(peerConn) {
            if (!peerConn) {
              return Promise.reject(res.serverError('Unable to create peer connection'));
            }

            // subscribe peer connection to socket
            PeerConnection.subscribe(req.socket, peerConn);

            return peerConn;
          });
      });

      var saveInitiator = function(peerConn, initiatorPeer) {
        console.log('OUTBOUND', peerConn);
        initiatorPeer.connections.add(peerConn.id);

        return initiatorPeer.save()
          .then(function(upd) {
            if (!upd) {
              return Promise.reject(new Error('DB error, hit race condition updating peer', initiatorPeer.id, 'with outbound conn', peerConn.id));
            }

            return upd;
          });
      };

      var saveReceiver = function(peerConn, receiverPeer) {
        console.log('INBOUND', peerConn.endpoint);
        receiverPeer.connections.add(peerConn.id);

        return receiverPeer.save()
          .then(function(upd) {
            if (!upd) {
              return Promise.reject(new Error('DB error, hit race condition updating peer', receiverPeer.id, 'with inbound conn', peerConn.id));
            }

            return upd;
          });
      };

      var peerConn;

      return makePc(receiverPeer)
        .then(function(pc) {
          peerConn = pc;
          return saveInitiator(peerConn, initiatorPeer);
        })
        .then(function(ip) {
          initiatorPeer = ip;
          return saveReceiver(peerConn, receiverPeer);
        })
        .then(function(rp) {
          receiverPeer = rp;
          return [peerConn, initiatorPeer, receiverPeer];
        })
        .error(function(e) {
          sails.log.error('makePc error', e);
        })
        .catch(function(e) {
          sails.log.error('makePc catch', e);
        });
    };

    var init = getPeerBySocketId(socketId).then(getPeerMatch).spread(hookupPeerConnection);

    init
      .spread(function(peerConn, initiatorPeer, receiverPeer) {
        sails.log.info(peerConn, initiatorPeer, receiverPeer);

        // subscribe peer connection to socket
        //PeerConnection.subscribe(req.socket, peerConn);
        PeerConnection.subscribe([req.socket, receiverPeer.socketId], peerConn);

        //Peer.publishAdd(initiatorPeer.id, 'connections', peerConn.id, null, { noReverse: true });
        //Peer.publishAdd(receiverPeer.id, 'connections', peerConn.id, null, { noReverse: true });

        // TODO maybe leave in?
        Peer.subscribe(req.socket, initiatorPeer);
        //Peer.subscribe(req.socket, receiverPeer);

        PeerConnection.publishCreate(peerConn, req.socket);

        return res.json({ status: 200, connection: peerConn });
      })
      .error(function(err) {
        sails.log.error('PeerConnectionController#create: DB error', e);
        return res.serverError('DB error', e);
      })
      .catch(Error, function(e) {
        sails.log.error('PeerConnectionController#create: Internal server error', e);
        return res.serverError('Internal server error', e);
      })
      .catch(function(e) {
        sails.log.error('PeerConnectionController#create: Other internal server error', e);
        return res.serverError('Other internal server error', e);
      });

  },

  message: function(req, res) {
    if (!req.isSocket) {
      return res.badRequest('Peer management only supported with sockets');
    }

    var peerConnectionId = req.param('id');
    var data = req.param('data');
    var socketId = req.socket.id;

    var getPeerConnectionById = Promise.method(function(peerConnectionId) {
      return PeerConnection.findOneById(peerConnectionId)
        .populate('endpoint')
        .then(function(peerConn) {
          if (!peerConn) {
            return Promise.reject(res.serverError('Can not message a nonexistent peer connection'));
          }

          return peerConn;
        });
    });

    // update reserved state to connecting state as required
    var updateState = function(peerConn) {
      if (peerConn.state === 'reserved') {
        var previousPeerConn = peerConn.toObject();

        return PeerConnection.update({ id: peerConn.id },
                                     { state: 'connecting' })
          .then(function(updated) {
            if (!updated || updated.length === 0) {
              return Promise.reject(res.serverError('Could not change nonexistent peer connection state'));
            }

            updated = updated[0];

            // publish update if needed
            sails.log.info('PeerConnection#message: updateState for peer connection id', updated.id, 'new state', updated.state, 'previous', peerConn);
            PeerConnection.publishUpdate(updated.id, { state: updated.state }, null, { previous: peerConn });

            return peerConn;
          });
      }

      // some other state
      return peerConn;
    };

    getPeerConnectionById(peerConnectionId)
      .then(updateState)
      .then(function(peerConn) {
        // we'll subscribe them to the peer connection
        // this is *especially* needed after a peer connection is first initiated
        // the remote peer knows they they were added as one of their children, but can't be subscribed
        // it is the remote peer's responsibility to make an offer using message
        // this will, in effect, subscribe them to the future of the channel

        sails.log.info('PeerConnection#message: Subscribing socket', socketId, 'to peer connection', peerConn.id);
        PeerConnection.subscribe(req.socket, peerConn);

        // now we'll forward the message on, exclude the sender
        PeerConnection.message(peerConn, data, req.socket);

        // let our guy know all is well
        return res.json({ status: 200 });
      })
      .error(function(err) {
        sails.log.error('PeerConnectionController#message: DB error', e);
        return res.serverError('DB error');
      })
      .catch(Error, function(e) {
        sails.log.error('PeerConnectionController#message: Internal server error', e);
        return res.serverError('Internal server error');
      })
      .catch(function(e) {
        return res.serverError('Other internal server error');
      });

  },

  destroy: function(req, res) {
    if (!req.isSocket) {
      return res.badRequest('Peer management only supported with sockets');
    }

    var socketId = req.socket.id;
    var peerConnectionId = req.param('id');

    var getPeerConnectionById = Promise.method(function(peerConnectionId) {
      return PeerConnection.findOneById(peerConnectionId)
        .populate('endpoint')
        .then(function(peerConn) {
          if (!peerConn) {
            return Promise.reject(res.serverError('Can not destroy nonexistent peer connection'));
          }

          return peerConn;
        });
    });

    var destroyPeerConnection = function(peerConn) {
      return PeerConnection.destroy({ id: peerConn.id })
        .then(function() {
          return peerConn;
        });
    };

    getPeerConnectionById(peerConnectionId)
      .then(destroyPeerConnection)
      .then(function(peerConn) {
        sails.log.info('PeerConnection#destroy: Destroying peer connection', peerConn.id, 'by request of socket', socketId);

        // publish the destroy
        PeerConnection.publishDestroy(peerConn.id, null, { previous: peerConn });

        return res.json({ status: 200 });
      })
      .error(function(err) {
        sails.log.error('PeerConnectionController#destroy: DB error', e);
        return res.serverError('DB error');
      })
      .catch(Error, function(e) {
        sails.log.error('PeerConnectionController#destroy: Internal server error', e);
        return res.serverError('Internal server error');
      })
      .catch(function(e) {
        return res.serverError('Other internal server error');
      });

  },

  finalize: function(req, res) {
    if (!req.isSocket) {
      return res.badRequest('Peer management only supported with sockets');
    }

    var peerConnectionId = req.param('id');
    var socketId = req.socket.id;

    var getPeerConnectionById = Promise.method(function(peerConnectionId) {
      return PeerConnection.findOneById(peerConnectionId)
        .populate('initiator')
        .populate('endpoint')
        .then(function(peerConn) {
          if (!peerConn) {
            return Promise.reject(res.serverError('Can not finalize a nonexistent peer connection'));
          }

          return peerConn;
        });
    });

    // update reserved state to connecting state as required
    var updateState = Promise.method(function(peerConn) {
      sails.log.info('PeerConnection#finalize: step 2', peerConn);

      if (peerConn.state !== 'established') {
        var newState = 'established';

        if (peerConn.endpoint.socketId === socketId) {
          if (peerConn.state !== 'init_established') newState = 'recv_' + newState;
        } else if (peerConn.initiator.socketId === socketId) {
          if (peerConn.state !== 'recv_established') newState = 'init_' + newState;
        } else {
          // WTF?
          throw new Error('Neither the receiver or initiator peer were responsible for finalizing the peer connection');
        }

        sails.log.info('PeerConnection#finalize: step2 updating peer connection', peerConn.id, 'with new state', newState, 'from old state', peerConn.state);

        return PeerConnection.update({ id: peerConn.id }, { state: newState })
          .then(function(updated) {
            if (!updated || updated.length === 0) {
              return res.serverError('Could not change nonexistent peer connection state');
            }

            updated = updated[0];

            // publish update
            sails.log.info('PeerConnection#finalize: updateState for peer connection id', updated.id, 'new state', updated.state, 'previous', peerConn);
            PeerConnection.publishUpdate(updated.id, { state: updated.state }, null, { previous: peerConn });

            return peerConn;
          });
      } else {
        // already in established state
        return peerConn;
      }
    });

    getPeerConnectionById(peerConnectionId)
      .then(updateState)
      .then(function(peerConn) {
        sails.log.info('PeerConnection#message: Finalizing peer connection', peerConn.id, 'into state', peerConn.state, 'by request of socket', socketId);

        return res.json({ status: 200, state: peerConn.state });
      })
      .error(function(err) {
        sails.log.error('PeerConnectionController#finalize: DB error', e);
        return res.serverError('DB error');
      })
      .catch(Error, function(e) {
        sails.log.error('PeerConnectionController#finalize: Internal server error', e);
        return res.serverError('Internal server error');
      })
      .catch(function(e) {
        return res.serverError('Other internal server error');
      });

  }

};
