/**
 * Peer.js
 *
 * @description :: Represents a peer, which is an individual node in the peer to peer network
 * @docs	:: http://sailsjs.org/#!documentation/models
 */

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

    canRebroadcast: function() {
      // broadcasters can always rebroadcast
      // TODO is this really true? should broadcaster have a parent peerconnection to itself?
      // this would mean that if their camera goes down their self peerconnection goes down too
      if (this.broadcaster) return true;

      if (this.parent.state === 'established') return true;

      return false;
    }
  }

};

module.exports = Peer;
