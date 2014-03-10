/**
 * PeerConnection.js
 *
 * @description :: Represents a single connection between two peers
 * @docs	:: http://sailsjs.org/#!documentation/models
 */

var _ = require('lodash');

const PeerConnectionStates = [ 'reserved', 'connecting',
			       'init_established', 'recv_established',
			       'established' ];

var PeerConnection = {
  adapter: 'memory',

  types: {
    state: function(state) {
      return _.contains(PeerConnectionStates, state);
    }
  },

  attributes: {
    state: {
      type: 'string',
      state: true,
      required: true
    },

    initiator: {
      model: 'Peer',
      via: 'id',
      required: true
    },

    receiver: {
      model: 'Peer',
      via: 'id',
      required: true
    },

    getPeerEndpoint: function getPeerEndpoint(selfPeer) {
      var resolver = Promise.pending();

      if (!_.isObject(selfPeer)) {
        resolver.reject(new Error('selfPeer is not an object'));
      }

      // what is the peer's endpoint id?
      // it could be the endpoint is either the initiator or receiver
      var endpointId = this.initiator;

      if (endpointId === selfPeer.id) {
	// if the guessed endpoint id is the same as the peer's id, then we really want the other peer
	endpointId = this.receiver;
      }

      // TODO figure out how to use promise to do this resolver
      Peer.findOneById(endpointId, function(err, peer) {
	if (err) resolver.reject(err);
	else resolver.resolve(peer);
      });

      return resolver.promise;
    }
  }
};

module.exports = PeerConnection;
