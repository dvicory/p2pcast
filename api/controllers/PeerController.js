/**
 * PeerController.js
 *
 * @description ::
 * @docs        :: http://sailsjs.org/#!documentation/controllers
 */

var Promise = require('bluebird');

var PeerController = {
  create: function(req, res, next) {
    if (!req.isSocket) {
      return res.badRequest('Peer management only supported with sockets');
    }

    var socketId = req.socket.id;
    var channelId = req.param('channel');
    var isBroadcaster = false;

    // check the channel exists
    Channel.findOneById(channelId)
      .populate('owner')
      .then(function(channel) {
	sails.log.info('Peer#create: then 1', channel);

	// if it doesn't exist, don't try to be a peer for it
	if (!channel) {
	  sails.log.warn('Socket', socketId, 'requested to be a peer for nonexistent channel', channelId);
	  return res.notFound('Can not be a peer for a nonexistent channel');
	}

	// if we're the owner we're also a broadcaster
	if (channel.owner.id === req.session.user.id) {
	  isBroadcaster = true;
	}
      })
      .fail(function(err) {
	if (err) {
	  sails.log.error('Socket', socketId, 'requested to be a peer for channel', channelId, ', errored with', err);
	  return res.serverError('DB error');
	}
      });

    // find, or create the peer if necessary
    Peer.findOrCreate({ socketID: socketId },
		      { socketID: socketId, channel: channelId, broadcaster: isBroadcaster })
      .then(function(peer) {
	sails.log.info('Peer#create: then 2', peer);

	if (!peer) {
	  // WTF?
	  sails.log.error('Tried to find or create peer on socket', socketId, 'for channel', channelId, 'which could not find or create!');
	  return res.serverError('DB error');
	}

	// set broadcaster
	peer.broadcaster = isBroadcaster;
	peer.save();

	// subscribe this socket to updates on his peer model instance
	Peer.subscribe(req.socket, peer);

	res.json(peer);
      })
      .fail(function(err) {
	if (err) {
	  sails.log.error('Tried to find or create peer on socket', socketId, 'for channel', channelId, 'errored with', err);
	  return res.serverError('DB error');
	}
      });
  },

  destroy: function(req, res, next) {
    if (!req.isSocket) {
      return res.badRequest('Peer management only supported with sockets');
    }

    var socketId = req.socket.id;
    var peerId = req.param('id');

    Peer.findOneById(peerId)
      .then(function(peer) {
	if (!peer) {
          sails.log.warn('Peer', socketId, 'requested to destroy nonexistent peer', peerId);
          return res.notFound('Can not destroy peer that does not exist');
	}

	Peer.destroy({ id: peer.id }).exec(function(){});

	Peer.publishDestroy(peer.id, null, { previous: peer });

	return res.json(peer);
      })
      .fail(function(err) {
	if (err) {
	  sails.log.error('Tried to destroy peer', peerID, 'for socket', socketID, 'errored with', err);
	  return res.serverError('DB error');
	}
      });
  }
};

module.exports = PeerController;
