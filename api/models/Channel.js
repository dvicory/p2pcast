/**
 * Channel.js
 *
 * @description :: TODO: You might write a short summary of how this model works and what it represents here.
 * @docs		:: http://sailsjs.org/#!documentation/models
 */

var Channel = {
  attributes: {
    name: {
      type: 'string',
      required: true,
      unique: true,
      minLength: 4,
      maxLength: 100
    },

    owner: {
      model: 'User',
      required: true
    }
  }
};

module.exports = Channel;
