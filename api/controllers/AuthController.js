/**
 * AuthController.js
 *
 * @description ::
 * @docs        :: http://sailsjs.org/#!documentation/controllers
 */

var Promise = require('bluebird');
var bcrypt = Promise.promisifyAll(require('bcrypt-nodejs'));

var Auth = {
  login: function(req, res) {
    Promise.promisifyAll(User);

    var email = req.param('email');

    User.findOneByEmailAsync(email).then(function(user) {
      if (!user) {
	sails.log.info('Auth#login: Received invalid login, no user', email);
        res.json({ error: 'User not found' }, 404);
      } else {
        bcrypt.compareAsync(req.param('password'), user.password).then(function(match) {
          if (match) {
            // passwords match, set session
            req.session.user = user.id;
            res.json(user);
          } else {
            // handle invalid password
            if (req.session.user) {
              req.session.user = null;
              delete req.session.user;
            }

	    sails.log.info('Auth#login: Received invalid password attempt', email);
            res.json({ error: 'Invalid password' }, 400);
          }
        }).error(function(e) {
	  sails.log.error('Auth#login: Server error', e);
          res.json({ error: 'Server error' }, 500);
        });
      }
    }).error(function(e) {
      sails.log.error('Auth#login: DB error', e);
      res.json({ error: 'DB error' }, 500);
    });
  },

  logout: function(req, res) {
    if (req.session.user) {
      req.session.user = null;
      delete req.session.user;
    }

    res.send({ session: req.session });
  }
};

module.exports = Auth;
