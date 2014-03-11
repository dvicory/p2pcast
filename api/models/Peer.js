/**
 * Peer.js
 *
 * @description :: Represents a peer, which is an individual node in the peer to peer network
 * @docs	:: http://sailsjs.org/#!documentation/models
 */

var Promise = require('bluebird');

var Peer = {
  adapter: 'memory',

  attributes: {
    socketID: {
      type: 'string',
      unique: true,
      required: true
    },

    user: {
      model: 'User'
    },

    channel: {
      model: 'Channel',
      required: true
    },

    broadcaster: {
      type: 'boolean',
      required: true
    },

    parent: {
      model: 'PeerConnection',
      via: 'initiator'
    },

    children: {
      collection: 'PeerConnection',
      via: 'receiver'
    },

    canRebroadcast: function canRebroadcast() {
      // broadcasters can always rebroadcast
      // TODO is this really true? should broadcaster have a parent peerconnection to itself?
      // this would mean that if their camera goes down their self peerconnection goes down too
      if (this.broadcaster) return true;

      if (this.parent && this.parent.state === 'established') return true;

      return false;
    }
  },

  getPeerBySocketId: function getPeerBySocketId(socketId) {
    var resolver = Promise.defer();

    sails.models.peer.findOneBySocketID(socketId)
      .populate('channel')
      .exec(function(err, peer) {
        if (err) resolver.reject(err);

        if (!peer) {
          resolver.reject(new Error('No peer exists by that socketId'));
        }

        resolver.resolve(peer);
      });

    return resolver.promise;
  },

  afterPublishRemove: function afterPeerPublishRemove(id, attribute, idRemoved, req) {
    sails.log.info('Peer#afterPublishRemove: id', id, 'attribute', /*attribute,*/ 'idRemoved', idRemoved, 'req', req);
  },

  afterPublishDestroy: function afterPeerPublishDestroy(id, attribute, idRemoved, req) {
    // see if I can destroy my parent peer connection
    var parentDestroyer = function(removedPeer) {
      var resolver = Promise.defer();

      // it's okay if there is none
      if (!removedPeer.parent) {
        sails.log.info('Peer#afterPublishDestroy: No parent to destroy for peer', removedPeer.id);
	resolver.resolve(0);
      } else {
	PeerConnection.destroy(removedPeer.parent.id, function(err) {
	  if (err) resolver.resolve(0);

	  sails.log.info('Peer#afterPublishDestroy: Destroyed parent connection', removedPeer.parent.id);

	  PeerConnection.publishDestroy(removedPeer.parent.id);
	  resolver.resolve(1);
	});
      }

      return resolver.promise;
    };

    var childDestroyer = function(removedPeer) {
      var resolver = Promise.defer();

      // it's okay if there is none
      if (!removedPeer.children) {
	sails.log.info('Peer#afterPublishDestroy: No children to destroy for peer', removedPeer.id);
	resolver.resolve(0);
      } else {
	PeerConnection.destroy({ receiver: removedPeer.id }, function(err) {
	  if (err) resolver.resolve(0);

	  sails.log.info('Peer#afterPublishDestroy: Destroyed child connections using', removedPeer.id, 'as the receiver');

	  _.each(removedPeer.children, function(child) {
	    PeerConnection.publishDestroy(child.id);
	  });

	  resolver.resolve(removedPeer.children.length);
	});
      }

      return resolver.promise;
    };

    Promise.join(parentDestroyer(idRemoved.previous), childDestroyer(idRemoved.previous)).spread(function(num1, num2) {
      sails.log.info('Peer#afterPublishDestroy: id', id, 'attribute', /*attribute,*/ 'idRemoved', idRemoved, 'req', req, 'num1', num1, 'num2', num2);
    });
  }

};

module.exports = Peer;
