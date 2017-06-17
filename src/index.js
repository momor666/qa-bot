'use strict';

const express = require( 'express'),
      path = require( 'path'),
      morgan = require( 'morgan'),
      bodyParser = require( 'body-parser'), 
      config = require( 'config'),
      crypto = require( 'crypto'),
      https = require( 'https'),
      request = require( 'request'),
      session = require( 'express-session'),
      synaptic = require( 'synaptic'),
      NaturalSynaptic = require( 'natural-synaptic'),
      limdu = require('limdu');

const app = express();

app.set('port', process.env.PORT || 5000);
app.use(morgan('dev'));
app.use(bodyParser.json({ verify: verifyRequestSignature }));               
app.use('/', express.static(path.join(__dirname, './../public')));

app.use(function(err, req, res, next) {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

var Neuron = synaptic.Neuron,
  	Layer = synaptic.Layer,
  	Network = synaptic.Network,
  	Trainer = synaptic.Trainer,
  	Architect = synaptic.Architect;
var limduClassifier;

const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ? 
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL');
  
if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

request({
  url: 'https://graph.facebook.com/v2.9/me/thread_settings',
  qs: {access_token: PAGE_ACCESS_TOKEN},
  method: 'POST',
  json: {
    "setting_type":"call_to_actions",
    "thread_state":"new_thread",
    "call_to_actions":[
      {
        "payload":"PAYLOAD_NEW_THREAD"
      }
    ]
  }
}, function(error, response, body) {
  if (error) {
    console.log('Error sending message: ', error);
  } else if (response.body.error) {
    console.log('Error: ', response.body.error);
  }
});

// greeting
request({
  url: 'https://graph.facebook.com/v2.9/me/thread_settings',
  qs: {access_token: PAGE_ACCESS_TOKEN},
  method: 'POST',
  json: {
    "setting_type":"greeting",
    "greeting":{
      "text": "Сайн байна уу! Би GREEN ERP бот байна."
      }
    }
  }, function(error, response, body) {
    if (error) {
      console.log('Error sending message: ', error);
    } else if (response.body.error) {
      console.log('Error: ', response.body.error);
  }
});

app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);          
  }  
});

app.post('/webhook', function (req, res) {
  var data = req.body;

  if (data.object == 'page') {
   
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      pageEntry.messaging.forEach(function(messagingEvent) {
        if (messagingEvent.message) {
          receivedMessage(messagingEvent);
        } else {
          console.log("Webhook received unknown messagingEvent: ", messagingEvent);
        }
      });
    });

    res.sendStatus(200);
  }
});

function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];

  if (!signature) {
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:", 
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;

  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;

  if (isEcho) {
    console.log("Received echo for message %s and app %d with metadata %s", 
      messageId, appId, metadata);
    return;
  } else if (quickReply) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s",
      messageId, quickReplyPayload);

    sendTextMessage(senderID, "Quick reply tapped");
    return;
  }

  if (messageText) {
    //limdu ээс асуух
    var result = toAnswerLimdu(messageText);
    console.log("ҮР ДҮН: "+result);
    sendTextMessage(senderID, result == null ? "Уучлаарай, ойлгомжгүй өгөгдөл байна. :)" : result);
  } else if (messageAttachments) {
    sendTextMessage(senderID, "Message with attachment received");
  }
}
function readJSON(){
  var fs = require('fs');
  return JSON.parse(fs.readFileSync('data/training_data.json', 'utf8'));
}
//хэлийг судлах with synaptic
function learnLanguage(jsonWord, text){
  jsonWord.forEach(function(data){
    //өгөгдлийн сүлжээг үүсгэж байна
    var inputLayer = new Layer(data.input);
    var hiddenLayer = new Layer(data.input.split(" "));
    var outputLayer = new Layer(data.output);
    
    inputLayer.project(hiddenLayer);
    hiddenLayer.project(outputLayer);
    
    var myNetwork = new Network({
    	input: inputLayer,
    	hidden: [hiddenLayer],
    	output: outputLayer
    });    
  });
}

// limdu ээр хэлийг судлах
function learnWithLimdu(json){
  // Олон түвшингээр давтан суралцах
  var TextClassifier = limdu.classifiers.multilabel.BinaryRelevance.bind(0, {
  	binaryClassifierType: limdu.classifiers.Winnow.bind(0, {retrain_count: 10})
  });
  
  // Өгүүлбэрт буй үгнүүдийг хоосон зайгаар нь салгаж аван шинж чанарууд үүсгэх
  var WordExtractor = function(input, features) {
  	input.split(" ").forEach(function(word) {
  		features[word]=1;
  	});
  };
  
  //Шинж чанаруудаар нь ангилах 
  limduClassifier = new limdu.classifiers.EnhancedClassifier({
  	classifierType: TextClassifier,
  	featureExtractor: WordExtractor
  });
  
  // Суралцах туршилт эхлүүлэх
  limduClassifier.trainBatch(json);
  
}
//limdu ашиглан хариулах
function toAnswerLimdu(question){
  return limduClassifier.classify(question);
}
//synaptic ашиглан хариулах
function toAnswerSynaptic(question){
  
}

// текст илгээх
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
       cmetametadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}

function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.9/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s", 
          messageId, recipientId);
      } else {
      console.log("Successfully called Send API for recipient %s", 
        recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });  
}
app.listen(app.get('port'), function() {
  console.log('Bot server is running on port', app.get('port'));
  //learn start here
  learnWithLimdu(readJSON());//demo сургалт энд хийгдэнэ.
});

module.exports = app;