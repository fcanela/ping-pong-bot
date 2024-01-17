# Developer Notes

There is some trade-offs considered during the development process:
- This tries to be an one-shot attempt to solve a problem: the bot must work without fixes or patches and I should not issue any manual action to fix issues (like missing pongs). I took decisions considering this that added complexity, as I usually prefer to be alerted on those cases so I can understand the issue and meditate an appropriate behavior.
- Effectiveness (issuing one pong per ping) of this one-shot application has been prioritized over performance. For example, sometimes I applied for iterations just to have detailed logs that help me to follow the application flow and ensure it is working as expected.

There are A LOT of things that could be refactored or improved, but one have to say *enough* at some point and I found the application being already effective. Things that I think I could have done better:
- The tests allowed me to find an fix a tons of issues, but I am not very happy with them: there is only unit testing and they are more coupled to the implementation than what I am used to. I wish I knew some tooling to perform integration testing with contracts.
- The wait between iterations is fixed, but it should be skipped if the previous iteration processed the max amount of blocks per iteration and there are more pending. This can slow the recovery process when it needs to restart from a very old starting block.
- Inconsistent use of enums and string literals in the types.
- `EthereumService` name doesn't look like the best name for the abstraction.
- This was my first rodeo with LevelDB. It works well. I have mixed feelings about their API ergonomics for this application use case though: some parts could have been cleaner with SQLite.
