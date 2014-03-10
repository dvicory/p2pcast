/**
 * User.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs		:: http://sailsjs.org/#!documentation/models
 */

var _ = require('lodash');
var Promise = require('bluebird');
var bcrypt = Promise.promisifyAll(require('bcrypt-nodejs'));

var hashPasswordHook = function hashPassword(attrs, next, isUpdate) {
  // this is an update but it didn't contain a new password
  // we shouldn't hash undefined or something terrible...
  if (isUpdate && !_.isString(attrs.password)) {
    next();
  }

  bcrypt.genSaltAsync(10).then(function(salt) {
    return bcrypt.hashAsync(attrs.password, salt, null);
  }).then(function(hash) {
    attrs.password = hash;
  }).then(next).error(function(e) {
    sails.log.error('could not hash password', e);
    next(e);
  });
};

var User = {
  beforeCreate: hashPasswordHook,
  beforeUpdate: _.partialRight(hashPasswordHook, true),

  attributes: {
    email: {
      type: 'email',
      unique: true,
      required: true
    },

    password: {
      type: 'string',
      required: true,
      minLength: 4
    },

    toJSON: function userToJSON(arg) {
      var obj = this.toObject();

      if (sails.config.environment === 'development') {
        return obj;
      } else {
        return _.pick(obj, 'id', 'email', 'createdAt', 'updatedAt');
      }
    }
  }
};

module.exports = User;
