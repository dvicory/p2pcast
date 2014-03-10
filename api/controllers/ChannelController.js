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
        sails.log.error('Channel#index: ', err);
        res.serverError('DB error'); 
      }

      if (req.wantsJSON || req.isSocket) { 
        return res.json({
          channels: channels
        });

      } else {
        return res.view({
          channels: channels
        });
      }
    }); 
  }
}

module.exports = ChannelController;
