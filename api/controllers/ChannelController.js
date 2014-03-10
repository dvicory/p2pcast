/**
 * ChannelController.js
 *
 * @description ::
 * @docs        :: http://sailsjs.org/#!documentation/controllers
 */

var ChannelController = {
  index: function(req, res) {
    Channel.find().populate('owner').exec( function(err, result) {
//      sails.log.info(result);
      
      if(err) sails.log.error(err);
      
      if (req.wantsJSON || req.isSocket) { 
        return res.json({
          channels: result
        });

      }
      else {
        return res.view({
          channels: result
        });

      }

    }); 
  }
}
module.exports = ChannelController;
