/**
 * ChannelController.js
 *
 * @description ::
 * @docs        :: http://sailsjs.org/#!documentation/controllers
 */
var Promise = require('bluebird');

var ChannelController = {
  index: function(req, res) {

    Channel.find().populate('owner').exec(function(err, channels) {
      if (err) {
        sails.log.error('Channel#index: DB error', err);
        return res.serverError('DB error');
      }

      if (req.wantsJSON || req.isSocket) {
        return res.json({
          channels: channels
        });
      } else {
        return res.view({
          channels: channels,
          title: "Channels"
        });
      }
    });
  },

  show: function(req, res) {

    Channel.findOneById(req.param('id')).populate('owner').exec(function(err, channel) {
      if (err) {
        sails.log.error('Channel#show: DB error', err);
        return res.serverError('DB error');
      }

      if (!channel) {
        return res.notFound('Channel Not Found');
      }

      var isBroadcaster = false;
      if (req.wantsJSON || req.isSocket) {
        return res.json({
          channel: channel
        });
      } else {
        return res.view({
          channel: channel,
          title: channel.name
        });
      }
    });
  },

  create: function(req, res) {
    Promise.promisifyAll(Channel);

    var name  = req.param('name');
    var owner = req.param('owner');

    if(!req.session.user) return res.json({ error: 'user not undefined'}, 500);
    
    Channel.createAsync({name: name, owner: req.session.user.id }).then(function(channel) {
      if (!channel) {
        sails.log.info('Channel#create: Channel already exists', name);
        return res.json({ error: 'Channel already exists' }, 500);
      }

      return res.redirect('/channel/' + channel.id);

    }).error(function(e) {
      sails.log.error('Auth#create: DB error', e);
      return res.json({ error: 'DB error' }, 500); 
    });


  }

}

module.exports = ChannelController;
