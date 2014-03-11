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
  },

  create: function(req, res) {
    Promise.promisifyAll(User);

    var name  = req.param('name');
    var email = req.param('email');
    var password = req.param('password');

    // TODO: much unsecure
    User.createAsync( { name: name, email: email, password: password } ).then(function(user) {
      if (!user) {
        sails.log.info('Auth#create: User already exists', req.param('email'));
        return res.json({ error: 'User already exists' }, 500);
      }

      req.session.user = { id: user.id, name: user.name, email: user.email };
      req.session.save();
      return res.redirect('back');
    }).error(function(e) {
      sails.log.error('Auth#login: DB error', e);
      return res.json({ error: 'DB error' }, 500);      
    });
  }

}

module.exports = UserController;
