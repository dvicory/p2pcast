/**
 * ChannelController.js
 *
 * @description ::
 * @docs        :: http://sailsjs.org/#!documentation/controllers
 */

var ChannelController = {
  index: function(req, res) {
    if (req.wantsJSON || req.isSocket) {
      return res.json({
        channels: [{ name: 'my first channel' }]
      });
    } else {
      return res.view({
	channels: [{ name: 'my first channel' }]
      });
    }
  }
};

module.exports = ChannelController;
