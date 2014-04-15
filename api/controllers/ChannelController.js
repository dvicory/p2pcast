/**
 * ChannelController.js
 *
 * @description ::
 * @docs        :: http://sailsjs.org/#!documentation/controllers
 */
var Promise = require('bluebird');

// Recusrive helper function 
function buildtree(peer, treeJSON) {

  //rootchildren = peer.forEach(getChildren)

  // get an array of children (peer) connections
  childrenConnections = peer.getChildren();

  children = {};

  // loop through the peer connections finding the peer object
  // and adding it to the children array based on their endpoint id 
  for(var j = 0; i < childrenConnections.length; j++) {
    children.push(findChildreByPeerId(childrenConnections[i].endpoint.id));
  }


  for(var i = 0; i < children.length; i++) {
    // check to see if returned empty object 
    // empty object means no more children
    if(!_.isEmpty(children[i])) {
      
      var temp = {"name": children[i].user.name,
                  "children": []
                  };

      // add it to the children array            
      treeJSON.children.push(temp);

      nextTreelevel = treeJSON.children[i];

      buildtree(peer, nextTreelevel);
    }
  }
}


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

    Channel.findOneById(req.param('id')).populate('owner').exec(function(err, channel) {
      if (err) {
        sails.log.error('Channel#show: DB error', err);
        return res.serverError('DB error');
      }

      if (!channel) {
        return res.notFound('Channel Not Found');
      }

      var isBroadcaster = false;
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
    });
  },

  create: function(req, res) {
    Promise.promisifyAll(Channel);

    var name  = req.param('name');
    var owner = req.param('owner');

    if(!req.session.user) return res.json({ error: 'user not undefined'}, 500);
    
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

  treeCreate: function(req, res) {
    if (!req.isSocket) {
      return res.badRequest('Peer management only supported with sockets');
    }

    var socketId = req.socket.id;
    var channelId = req.param('channel');

    // find the peer who is the broadcaster & begin from there 
    // TODO - might have to move this before helper function 
    var root = Peer.findOne({channel: channelId , broadcaster: true})
    .then( function(peer) {

      // create init object with the root 
      treeJSON = [
        { "name": "broadcaster - " + peer.user.name,
          "children" : []
        }
      ]

      // now for the recursive magic 
      buildtree(root, treeJSON[0]);

      // ready to be served
      return res.json(treeJSON);

    });

  },

};

module.exports = ChannelController;
