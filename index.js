var express = require('express');
var Promise = require('bluebird');
var app = express();
var config = require('./bandwidth.json');
var bodyParser = require('body-parser');
var http = require('http').Server(app);
var io = require('socket.io')(http);
var bandwidth = require('node-bandwidth');
bandwidth.Client.globalOptions.apiToken = config.apiToken;
bandwidth.Client.globalOptions.userId = config.userId;
bandwidth.Client.globalOptions.apiSecret = config.apiSecret;
var Application = Promise.promisifyAll(bandwidth.Application);
var PhoneNumber = Promise.promisifyAll(bandwidth.PhoneNumber);
var AvailableNumber = Promise.promisifyAll(bandwidth.AvailableNumber);
var Call = Promise.promisifyAll(bandwidth.Call);

var tn = '+19192059309';
var client = new bandwidth.Client(
	config.userId,
	config.apiToken,
	config.apiSecret);

//Checks the current Applications to see if we have one.
var configureApplication = function (appName) {
	return Application.listAsync(client, {
		size: 1000
	})
	.then(function (applications) {
		var applicationId = searchForApplication(applications, appName);
		if(applicationId !== false) {
			return fetchTNByAppId(applicationId);
		}
		else {
			return newApplication();
		}
	});
};

// Searches through application names and returns ID if matched
var searchForApplication = function (applications, name) {
	for (var i = 0; i < applications.length; i++) {
			if ( applications[i].name === name) {
				return applications[i].id;
			}
		}
	return false;
};

// Gets the first number associated with an application
var fetchTNsByAppId = function (applicationId) {
	return PhoneNumber.listAsync(client, {
		applicationId: applicationId
	})
	.then(function (numbers) {
		for (var i = 0; i < numbers.length; i++) {
			tns.push(numbers[i].number);
		}
		return tns;
	});
};

// Creates a new application then orders a number and assigns it to application
var newApplication =function (appName) {
	var applicationId;
	return Application.createAsync(client, {
			name: appName,
			incomingCallUrl: config.baseUrl + '/incomingCall/',
			callbackHttpMethod: 'get',
			autoAnswer: true
		})
		.then(function(application) {
			//search an available number
			applicationId = application.id;
			return AvailableNumber.searchLocalAsync(client, {
				areaCode: '415',
				quantity: 1
			});
		})
		.then(function(numbers) {
			// and reserve it
			tn = numbers[0].number;
			return PhoneNumber.createAsync(client, {
				number: tn,
				applicationId: applicationId
			});
		});
};

// Return promisified call creation
var makeCall = function(toNumber, fromNumber) {
	return Call.createAsync({
		from: fromNumber,
		to: toNumber,
		callbackUrl: config.baseUrl + '/callEvents'
	});
};

// Return promisified play audio, be sure to bind the call to the request
var playAudio = function (call, fileUrl) {
	return Promise.promisify(call.playAudio).bind(call)({
		fileUrl: fileUrl
	});
};

// Create a call object without another network request
var callFromCallback = function (callback) {
	var call = new Call();
	call.id = callback.callId;
	call.tag = callback.tag;
	call.client = client;
	return call;
};

var hangupCall = function (call) {
	return Promise.promisify(call.hangUp).bind(call)();
};

var handleCallback = function (req, res) {
	//console.log(req.body);
	if (req.body.eventType === 'answer') {
		call = callFromCallback(req.body);
		playAudio(call, 'https://s3.amazonaws.com/bandwidth-halloween/halloween.mp3')
		.then(function () {
			res.sendStatus(200);
		})
		.catch(function (e) {
			console.log(e);
			res.sendStatus(400);
		});
	}
	else if (req.body.eventType === 'playback' && req.body.status === 'done') {
		call = callFromCallback(req.body);
		hangupCall(call)
		.then(function () {
			res.sendStatus(200);
		})
		.catch(function (e) {
			console.log(e);
			res.sendStatus(400);
		});
	}
};

var newCallRequest = function (req, res) {
	console.log(req.body);
	var tnRegex = /^\d{3}-\d{3}-\d{4}/;
	if (!req.body || !req.body.phoneNumber || !tnRegex.test(req.body.phoneNumber)) {
		res.sendStatus(400);
	}
	else {
		var to = req.body.phoneNumber;
		to = '+1' + to.substring(0,3) + to.substring(4,7) + to.substring(8,12);
		makeCall(to, tn)
		.then(function () {
			res.sendStatus(201);
		})
		.catch(function (e) {
			console.log(e);
			res.sendStatus(400);
		});
	}
};

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('static'));
app.post('/callEvents', handleCallback);
app.post('/newCall', newCallRequest);

app.get('/', function (req, res) {
	res.sendFile(__dirname + '/index.html');
});

app.set('port', (process.env.PORT || 5000));
http.listen(app.get('port'), function(){
	console.log('listening on *:' + app.get('port'));
});


