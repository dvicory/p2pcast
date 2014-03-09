/**
 * UserController.js
 *
 * @description ::
 * @docs        :: http://sailsjs.org/#!documentation/controllers
 */

var _ = require('lodash');
var Promise = require('bluebird');

var UserController = {
  index: function(req, res) {
    res.send({ session: req.session });
  }
};

module.exports = UserController;
