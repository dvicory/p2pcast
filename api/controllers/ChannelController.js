/**
 * ChannelController.js
 *
 * @description ::
 * @docs        :: http://sailsjs.org/#!documentation/controllers
 */

var Promise = require('bluebird');

var ChannelController = {
  index: function(req, res) {

    Channel.find().populate('owner').exec(function(err, channels) {
      if (err) {
        sails.log.error('Channel#index: DB error', err);
        return res.serverError('DB error');
      }

      if (req.wantsJSON || req.isSocket) {
        return res.json({
          channels: channels
        });
      } else {
        return res.view({
          channels: channels,
          title: "Channels"
        });
      }
    });
  },

  show: function(req, res) {
    var criteria = { id: req.param('id') };
    if (!criteria.id) criteria = { name: req.param('name') };

    var findChannel = Promise.method(function(criteria) {
      return Channel.findOne(criteria)
        .populate('owner');
    });

    findChannel(criteria)
      .then(function(channel) {
        if (!channel) {
          return res.notFound('Channel not found');
        }

        if (req.wantsJSON || req.isSocket) {
          return res.json({
            channel: channel
          });
        } else {
          return res.view({
            channel: channel,
            title: channel.name
          });
        }
      })
      .error(function(e) {
        return res.serverError('Internal server error', e);
      });
  },

  create: function(req, res) {
    Promise.promisifyAll(Channel);

    var name  = req.param('name');
    var owner = req.param('owner');

    if (!req.session.user) {
      return res.json({ error: 'user not undefined'}, 500);
    }

    Channel.createAsync({name: name, owner: req.session.user.id }).then(function(channel) {
      if (!channel) {
        sails.log.info('Channel#create: Channel already exists', name);
        return res.json({ error: 'Channel already exists' }, 500);
      }

      return res.redirect('/channel/' + channel.id);

    }).error(function(e) {
      sails.log.error('Auth#create: DB error', e);
      return res.json({ error: 'DB error' }, 500);
    });

  },

  update: function(req, res) {
    var name  = req.param('name');
    var description = req.param('description');
    var id = req.param('id');

    if(typeof id === 'undefined'){
      req.flash('msg','channel id does not exist');
      console.log('channel id does not exist.');
      return res.redirect('/user');
    }

    var updatedChannel;
    Channel.update({ id: id },
                   { name: name, description: description },
                   function(err, channel) {
                     if (err) {
                       req.flash('msg', 'update failed');
                       console.log(err);
                       return res.redirect('/user');
                     } else {
                       console.log("Channel updated:", channel);
                       req.flash('msg','channel updated successfully');
                       return res.redirect('/user');
                     }
                   });
  },

  destroy: function(req, res) {
    var channelId = req.param('id');
    Channel.findOneById(channelId)
      .then(function foundRecord (channel) {
        if (!channel) {
          return res.notFound('No channel found with the specified `id`.');
        }

        req.flash('msg','Channel Deleted');
        res.redirect('back');

        return Channel.destroy(channelId);
      })
      .then(function (channel) {
        Channel.publishDestroy(channelId, req, { previous: channel });

        req.flash('msg','Channel Deleted');
        return res.redirect('back');
      });
  },

  tree: function(req, res) {
    profiler.startProfiling('buildTree');

    var channelId = req.param('id');

    var getChannel = Promise.method(function(channelId) {
      return Channel.findOneById(channelId)
        .then(function(channel) {
          if (!channel) {
            return Promise.reject(res.notFound('Channel not found'));
          }

          return channel;
        });
    });

    getChannel(channelId)
      .then(function(channel) {
        // TODO which broadcaster is best as root?
        var findOnePeer = Peer.findOne({ channel: channelId, broadcaster: true }).populate('connections');
        return [channel, findOnePeer];
      })
      .spread(function(channel, broadcaster) {
        if (!broadcaster) {
          return Promise.reject(new Error('No broadcasters found'));
        }

        return Promise.all([channel, broadcaster, broadcaster.buildTree()]);
      })
      .spread(function(channel, peer, treeJSON) {
        console.log('sending treeJSON', treeJSON);

        profiler.stopProfiling('buildTree');

        if (req.wantsJSON || req.isSocket) {
          return res.json(treeJSON, 200);
        } else {
          return res.view({
            channel: channel,
            title: channel.name,
            treeJSON: treeJSON
          });
        }
      })
      .error(function(e) {
        sails.log.error('Channel#treeCreate: Internal server error', e);
        return res.serverError('Internal server error', e);
      });
  }

};

module.exports = ChannelController;
