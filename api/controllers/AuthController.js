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
    var challenge = req.param('password');

    User.findOneByEmailAsync(email).then(function(user) {
      if (!user) {
        req.flash('loginMsg','Invalid email or password');
        sails.log.info('Auth#login: Received invalid login, no user', email);
        res.redirect('back');
        
      } else {
        bcrypt.compareAsync(challenge, user.password).then(function(match) {
          if (match) {
            // passwords match, set session
            req.session.user = { id: user.id, name: user.name, email: user.email };
            req.session.save();
            res.redirect('back');
          } else {
            // handle invalid password
            if (req.session.user) {
              req.session.user = null;
              delete req.session.user;
              req.session.save();
            }

            req.flash('loginMsg','Invalid email or password');
            sails.log.info('Auth#login: Received invalid password attempt', email);
            res.redirect('back');
          }
        }).error(function(e) {
          sails.log.error('Auth#login: Server error', e);
          return res.json({ error: 'Server error' }, 500);
        });
      }
    }).error(function(e) {
      sails.log.error('Auth#login: DB error', e);
      return res.json({ error: 'DB error' }, 500);
    });
  },

  logout: function(req, res) {
    if (req.session.user) {
      req.session.user = null;
      delete req.session.user;
    }

    res.redirect('back');
  }
};

module.exports = Auth;
