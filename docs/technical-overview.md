# Technical overview

## How it works?

A normal iteration follows the following flow:

![Normal iteration flow](./flow.png?raw=true "Normal iteration flow")

Unexpected issues (database not found, incomplete previous iteration...) triggers **Recovery Mode**:
- Starts reading the mempool and searching for issued pongs
- Until the most recent mined block is reached, it follows the same flow than "normal" with the following differences:
    - When reading the pongs, it needs to performs a deeper inspections to check the issuer.
    - No pong is issued. The bot needs to check information in the pending blocks first to ensure there isn't an untracked response already issued.
    - Stale pongs are ignored. The bot will check the information in the pending blocks first as they may be there.
- After finishing, it answers all the pending pings and returns to normal mode.

## Structure

Here goes a list of relevant files with a brief description:

- `.env.example`: Example environment configuration file. Needs to be copied as `.env` and populated
- `Dockerfile`: Docker configuration for containerizing the application.
- `compose.yaml`: Docker Compose configuration to easily start the bot, ensure it autorestarts and automount the data directory
- `src`: Main code directory
    - `index.ts`: Entry point of the application. Imports dependencies and starts the bot.
    - `ping_pong_bot.ts`: Core functionality of the PingPong bot. Orchestrates the logic.
    - `types.ts`: TypeScript type definitions used throughout the project.
    - `lib` 
        - `config.ts`: Configuration settings and environment variables.
        - `ethereum_service.ts`: Service module for Ethereum blockchain interactions.
        - `logger.ts`: Sets both terminal and file logging.
        - `shutdown.ts`: Graceful shutdown management.
        - `storage.ts`: Wraps the LevelDB database to make more readable and easy to interact with the storage.
        - `test_utils.ts`: Small snippets of code that were required in more than one test file.
- `data`: Database and logs are stored here
