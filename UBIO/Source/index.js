var CryptoAccount = require("send-crypto");
var express = require("express");
var fs = require("fs");
var io = require("kaeon-united")("io");

let settings = JSON.parse(io.open("./settings.json"));

let account = null;
let roundThreshold = settings.roundThreshold;

let address = "";

function host() {

	let app = express();

	app.use(
		express.urlencoded({
			extended: true
		})
	);

	app.use(express.json());

	app.get('/', (request, response) => {

		response.send(
			io.open("./index.html").
				replace("[ADDRESS]", address).
				replace("[WARNING]", settings.warning ?
					"<h6 id=\"disclaimer\"><b><i>IN DEVELOPMENT. USE WITH CAUTION.</i></b></h6>" :
					""
				)
		);
	});

	app.post('/subscribe', (request, response) => {

		try {
			response.send(subscribe(request.body));
		}

		catch(error) {

			console.log(error);

			response.send("SUBSCRIPTION FAILED");
		}
	});

	app.listen(80);
}

async function initialize() {

	if(settings.wallet == null || settings.wallet == "") {

		settings.wallet = CryptoAccount.newPrivateKey();

		io.save(JSON.stringify(settings, null, "\t"), "./settings.json");
	}

	account = new CryptoAccount(settings.wallet);
	address = await account.address("BTC");

	if(!fs.existsSync("./data.json")) {

		io.save(
			JSON.stringify({ subscribers: [], index: 0 }, null, "\t"),
			"./data.json"
		);
	}

	if(!fs.existsSync("./log.txt"))
		io.save("", "./log.txt");
}

function log(string) {

	console.log(string);

	io.save(
		(io.open("./log.txt") +
			"\n" +
			(new Date()).getTime() +
			": " +
			string).trim(),
		"./log.txt"
	);
}

async function main() {

	await initialize();

	host();
	monitor();
}

function monitor() {

	setInterval(async () => {

		let balance = await account.getBalanceInSats("BTC");
		let rounds = Math.floor(balance / (5460 * roundThreshold));

		log("BALANCE: " + (balance * 0.00000001));
		
		if(rounds > 0) {

			let data = JSON.parse(io.open("./data.json"));

			if(data.subscribers.length == 0) {

				log("NO SUBSCRIBERS");

				return;
			}

			let payout = { };
			let index = data.index;

			let limit = ((rounds / 2) <= data.subscribers.length) ?
				(rounds / 2) : data.subscribers.length;

			for(let i = 0; i < limit; i++) {

				payout[data.subscribers[index].wallet] =
					payout[data.subscribers[index].wallet] != null ?
						(payout[data.subscribers[index].wallet] + 1) : 1;

				index++;

				if(index >= data.subscribers.length)
					index = 0;
			}

			data.index = index;

			Object.keys(payout).forEach((key) => {

				log(
					"PAYING " +
					key +
					" " +
					0.00000001 * 5460 * roundThreshold * payout[key]
				);

				(async () => {
					
					try {

						await account.send(
							key,
							0.00000001 * 5460 * roundThreshold * payout[key],
							"BTC"
						);

						data = JSON.parse(io.open("./data.json"));
			
						io.save(
							JSON.stringify(data, null, "\t"),
							"./data.json"
						);

						log(
							"PAID " +
							key +
							" " +
							0.00000001 * 5460 * roundThreshold * payout[key]
						);
					}

					catch(error) {

						console.log(error);

						log(
							"FAILED " +
							key +
							" " +
							0.00000001 * 5460 * roundThreshold * payout[key]
						);
					}
				})();
			});
		}

		else {
			log("INSUFFICIENT FUNDS");
		}
	}, 1000 * 60);
}

function subscribe(subscriber) {

	if(typeof subscriber != "object")
		return "ERROR: INVALID SUBMISSION - NOT AN OBJECT";

	if(typeof subscriber.credentials != "object" ||
		typeof subscriber.wallet != "string" ||
		Object.keys(subscriber).length != 2) {
		
		return "ERROR: INVALID SUBMISSION - INVALID FORMAT";
	}

	if(typeof subscriber.credentials.email != "string" ||
		typeof subscriber.credentials.phone != "string" ||
		Object.keys(subscriber.credentials).length != 2) {
		
		return "ERROR: INVALID SUBMISSION - INVALID FORMAT - CREDENTIALS";
	}

	let emailTokens = subscriber.credentials.email.split("@");

	if(emailTokens.length != 2)
		return "ERROR: INVALID SUBMISSION - INVALID EMAIL";

	if(emailTokens[0].length == 0 || emailTokens[1].length == 0 ||
		emailTokens[0] == "@" || emailTokens[1] == "@") {

		return "ERROR: INVALID SUBMISSION - INVALID EMAIL";
	}

	if((subscriber.credentials.phone.length != 10 &&
			subscriber.credentials.phone.length != 11) ||
		Number(subscriber.credentials.phone) == NaN) {

		return "ERROR: INVALID SUBMISSION - INVALID PHONE NUMBER";
	}

	if(io.open(
			"https://blockstream.info/api/address/" + subscriber.wallet
		) == "") {
		
		return "ERROR: INVALID SUBMISSION - INVALID WALLET";
	}

	let data = JSON.parse(io.open("./data.json"));
	
	if(data.subscribers.filter(item => {

		return item.credentials.email == subscriber.credentials.email ||
			item.credentials.phone == subscriber.credentials.phone ||
			item.wallet == subscriber.wallet;
	}).length > 0) {

		return "ERROR: INVALID SUBMISSION - USER ALREADY EXISTS";
	}

	data.subscribers.push(subscriber);

	io.save(JSON.stringify(data, null, "\t"), "./data.json");

	return "SUBSCRIPTION SUCCESSFUL";
}

main();