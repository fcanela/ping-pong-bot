# PingPong bot

This bot is designed to interact with a Goerli smart contract that emits `ping` events. For each `ping` event it must reply with a pong. It shouldn't answer more than one time or omit any ping.

## Features

- Integration with multiple providers.
- Exchange tracking to reduce API calls.
- Recovery Mode to bring the system up after any unexpected issue (e.g., DNS, network or storage failure, fatal errors).
- Mempool inspection during Recovery Mode to avoid issuing double pongs.
- Automatic increase of transaction fees for stale transactions with low ones.
- Automatic reissue of transactions dropped from mempool.
- Waits a configurable number of confirmation blocks before trusting a `ping`.
- Configurable rate-limit, blocks to be processed per iteration, and other performance and security settings.
- Graceful shutdown that ensures the application can be restarted without losing state or corrupting the database.
- Easy to deploy and automatic restart on error thanks to Docker.
- Tested codebase and TypeScript.

## Documentation

- [Technical overview](./docs/technical-overview.md): provides a quick summary of the flow and files to make navigating the project easy.
- [Developer notes](./docs/developer-notes.md): some notes about decisions taken, parts of the codebase I am not happy with, etc. I hope it helps to share my thinking process better.

## Installation

Clone the repository:

```
git clone https://github.com/fcanela/ping-pong-bot.git
cd ping-pong-bot
```

Copy the `.env.example` as `.env`. Fill the environment variables, providing at least one provider API key.

## Usage

### Running the bot

Ensure you have `Docker` installed. It was tested with version `24.0.7`. After that, execute:

```
docker compose up
```

This is an example of a normal run (note that on a fresh start it begins in *Recovery Mode*, check the [Technical overview](./docs/technical-overview.md) notes for more details):
![Normal execution](./docs/run.gif?raw=true)


### Running the tests

Ensure you have `NodeJS` installed locally. The application was developed with version `21.2.0`. Install the application dependencies:

```
npm install
```

Ensure you have set the environment variables. One way of doing this is (on GNU systems) is:

```
export $(grep -v '^#' .env | xargs)
```

Run the tests suite:

```
npm test
```

It will take a few seconds as the tests are rate-limited like the real code.

![Tests execution](./docs/tests.gif?raw=true)

## Troubleshooting

- Ensure the `.env` file is filled
- If you are running the bot, ensure the address has funds to issue pongs
- If you are executing it locally, ensure you have loaded the environment variables
- If no pings are being issued, check if the account that issues the `ping` has funds. Sometimes that bot runs out of funds and needs a small donation.
- If you notice `unable to retrieve mempool transaction` errors during mempool inspection and the provider is `Infura`, that is a known issue on their end: approximately a 40% of mempool transactions returns `null` instead of the transaction when requested. Personally, I will not be running this bot with Infura to avoid this issue.

## License

[MIT](https://choosealicense.com/licenses/mit/)
