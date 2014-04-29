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
    if(req.session.user) {

      Channel.find({ owner: req.session.user.id }).then(function(channels) {
        if(!channels){
          sails.log.error('User#index: No channels found.');
          return res.serverError('No channels found');
        }

        if (req.wantsJSON || req.isSocket) {
          return res.json({
            channels: channels
          });
        } else {
          return res.view({
            channels: channels,
            title: 'Profile Page'
          });
        }
      });
    } else {
      return res.redirect('/');
    }
  },

  create: function(req, res) {
    var name = req.param('name');
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
      req.flash('registerMsg','user already exists');
      res.redirect('back');
      //return res.json({ error: 'DB error' }, 500);
    });
  },

  update: function(req, res) {

    var name  = req.param('name');
    var email = req.param('email');
    var password = req.param('password');

    var updatedUser;
    User.update({id: req.session.user.id }, {name: name, email: email, password: password},
      function(err, user) {
        if (err) {
          req.flash('msg','update failed');
          console.log(err);
          return res.redirect('/user');
        } else {
          console.log("Users updated:", user);
          req.session.user.name = name;
          req.session.user.email = email;
          req.session.save();
          req.flash('msg','updated successfully');
          return res.redirect('/user');
        }
    });
  }

};

module.exports = UserController;
