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
    var canBroadcast = false;
    var isBroadcaster = req.param('broadcaster') || false;

    // check the channel exists
    var step1 = function(channelId) {
      var resolver = Promise.defer();

      sails.log('channelId', channelId);

      Channel.findOneById(channelId)
	.populate('owner')
	.exec(function(err, channel) {
	  sails.log.info('Peer#create: then 1', channel);

	  if (err) resolver.reject(err);

	  // if it doesn't exist, don't try to be a peer for it
	  if (!channel) {
	    /*
	    sails.log.warn('Socket', socketId, 'requested to be a peer for nonexistent channel', channelId);
	    return res.notFound('Can not be a peer for a nonexistent channel');
	    */
	    resolver.reject(new Error('Can not be a peer for a nonexistent channel'));
	  }

	  // if we're the owner we can broadcast
	  if (req.session.user && channel.owner.id === req.session.user.id) {
	    canBroadcast = true;
	  }

	  resolver.resolve(socketId);
	});

      return resolver.promise;
    };

    // find, or create the peer if necessary
    var step2 = function(socketId) {
      var resolver = Promise.defer();

      sails.log.info('socketId', socketId, 'channel', channelId, 'isBroadcaster', isBroadcaster, 'canBroadcast', canBroadcast);

      Peer.findOrCreate({ socketID: socketId },
			{ socketID: socketId, channel: channelId, broadcaster: isBroadcaster && canBroadcast })
	.exec(function(err, peer) {
	  sails.log.info('Peer#create: then 2', peer);

	  if (err) resolver.reject(err);

	  if (!peer) {
	    // WTF?
	    /*
	    sails.log.error('Tried to find or create peer on socket', socketId, 'for channel', channelId, 'which could not find or create!');
	    return res.serverError('DB error');
	    */
	    sails.log.error('Peer#create: findOrCreate');
	    resolver.reject(new Error('DB error'));
	  }

	  // get rid of parent
	  peer.parent = null;

	  // set channel
	  peer.channel = channelId;

	  // set broadcaster
	  peer.broadcaster = isBroadcaster && canBroadcast;
	  peer.save();

	  // subscribe this socket to updates on his peer model instance
	  Peer.subscribe(req.socket, peer);

	  resolver.resolve(peer);
	});

      return resolver.promise;
    };

    sails.log.info('beforeSteps');

    step1(channelId).then(step2)
      .then(function(peer) {
	return res.json(peer);
      })
      .error(function(err) {
	sails.log.error('Peer#create: Socket', socketId, 'requested peer creation;', err.message);
        return res.json({ status: 404, message: err.message });
      })
      .catch(function(e) {
	sails.log.error(e);
        return res.serverError('Internal server error');
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
