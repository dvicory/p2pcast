/**
 * ChannelController.js
 *
 * @description ::
 * @docs        :: http://sailsjs.org/#!documentation/controllers
 */

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
  }

}

module.exports = ChannelController;
