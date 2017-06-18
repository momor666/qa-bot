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
var limduClassifier; //limdu classifier
var network; //synaptic network

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
    var result = toAnswerByLimdu(messageText);
    
    //Хэрэглэгчийн хайсан өгөгдөл олдсон эсэх
    if(result == null || result == ''){
      sendTextMessage(senderID, "Уучлаарай, i-STAR -ын судалж амжаагүй эсвэл хэтэрхий ерөнхий асуулт байна.");
      // askMore(senderID, messageText);
    }else
      sendTextMessage(senderID, result+"");
    
  } else if (messageAttachments) {
    sendTextMessage(senderID, "Message with attachment received");
  }
}
//хэрэглэгчийн хайсан өгөгдөл олдохгүй бол тодруулга авч дэлгэрүүлж хайх
function askMore(senderID, messageText){
      var similarWords = findSimilarKeyword(messageText);
      if(similarWords.length != 0){
        sendTextMessage(senderID, "Дараах түлхүүр үгүүдээс сонгоно уу");
        sendTextMessage(senderID, similarWords);
        // askSimilarOptions(senderID, similarWords);
      }
      else
        sendTextMessage(senderID, "Таны хайсан өгөгдөл олдсонгүй!");
}
//хайсан өгөгдөлийн хариулт олдоогүй үед төстэй асуултуудыг олох
function findSimilarKeyword(keyword){
  //хөрш үгнүүдийг array-д авч сонголт болгон илгээх
  var similarQuestions = new Array();
  var sum = "";
  readJSON().forEach(function(data){
    var words = data.input.split(" ");
    //тухайн түлхүүр үгээр эхэлсэн эсвэл түүнтэй хөрш үгнүүдийг олох
    if(words.indexOf(keyword) != -1){
      var index = words.indexOf(keyword);
      //тухайн үгтэй хөрш үгийг авах
      var neighborWord = index == words.length ? words[index-1]+" "+keyword : keyword+" "+words[index+1];
      //тухайн үг өмнө нь бүртгэгдээгүй бол
      if(sum.indexOf(neighborWord)==-1)
        sum+= sum=="" ? neighborWord : ","+neighborWord;
      similarQuestions.push({"content_type":"text","title":neighborWord});
    }
  });
    return sum;
}
//төстэй үгнүүдээс санал болгож асуух
function askSimilarOptions(recipientId, words){
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "Таны хайлт хэт ерөнхий байгаа тул, дараах сонголтуудаас сонгоно уу.",
      quick_replies: words
    }
  };

  callSendAPI(messageData);
}
//json файлаас өгөгдөл унших
function readJSON(){
  var fs = require('fs');
  return JSON.parse(fs.readFileSync('data/demo_data.json', 'utf8'));
}

//илүү тэмдэгтүүдийг цэвэрлэх
function cleanJSON(json){
  for(var i=0; i<json.length; i++){
    json[i].input = json[i].input.replace("/[\?\,\:]/", "");
  }
}
//хэлийг судлах with synaptic
function learnWithSynaptic(json){
  console.log("synaptic суралцаж эхэллээ...");
  json.forEach(function(data){
    //өгөгдлийн сүлжээг үүсгэж байна
    var inputLayer = new Layer(data.input);
    //Асуулт болон хариултын үгсийн олонлогийг нэгтгэх
    var mergedWords = data.input.split(" ").concat(data.output.split(" "));
    var hiddenLayer = new Layer(mergedWords);
    var outputLayer = new Layer(data.output);
    
    inputLayer.project(hiddenLayer);
    hiddenLayer.project(outputLayer);
    
    if(network == null)
      network = new Network({
      	input: inputLayer,
      	hidden: [hiddenLayer],
      	output: outputLayer
      });
    else
      network.project(
        new Network({
        	input: inputLayer,
        	hidden: [hiddenLayer],
        	output: outputLayer
    }));
    
  });
  console.log("synaptic суралцаж дууслаа.");
}

// limdu ээр хэлийг судлах
function learnWithLimdu(json){
  console.log("limdu суралцаж эхэллээ...");
  var startedTime = new Date().getTime();
  // Олон түвшингээр давтан суралцах
  var TextClassifier = limdu.classifiers.multilabel.BinaryRelevance.bind(0, {
  	binaryClassifierType: limdu.classifiers.Winnow.bind(0, {retrain_count: 100})
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
  console.log("limdu суралцаж дууслаа. \n Нийт "+json.length + " ширхэг өгөдлийг " + (new Date().getTime()-startedTime)/1000+" секундэд уншиж дууслаа.");
}
//limdu ашиглан хариулах
function toAnswerByLimdu(question){
  console.log("limdu хариултыг хайж байна...");
  var result =  limduClassifier.classify(question);
  console.log("limdu хариултыг оллоо.");
  return result;
}
//synaptic ашиглан хариулах
function toAnswerBySynaptic(question){
  console.log("synaptic хариултыг хайж байна...");
  var result =  network.activate(question);
  console.log("synaptic хариултыг оллоо.");
  return result;
}

// текст илгээх
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText
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
  learnWithLimdu(readJSON()); //LIMDU demo сургалт энд хийгдэнэ.
  // learnWithSynaptic(readJSON()); //SYNAPTIC demo сургалт энд хийгдэнэ.
});

module.exports = app;