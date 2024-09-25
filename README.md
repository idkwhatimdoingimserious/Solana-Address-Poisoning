# SolanaAddressPoisoning # !
basic tool for some solana address poisioning. it finds active addresses with a balance above X. It stores them. It generates private keys+public keys. It tries to match active addresses that have the same starting 4 characters to public addresses we have generated keypairs for. Then, it finds people who have interacted with the active address that we have a similar address to. Then, it funds from our main wallet, to our generated keypair, to our targets who have interacted with the active wallet. After this, it sends all unused funds back to your main wallet, and stores the transaction info in the monitoring wallets file so you can look back at it later and see if you recieved anything. This is a work in progress, but it at least works at this stage. Contact me on telegram @ccc666333 for more info. 


GENERATED - OUR WALLETS WE HAVE GENERATED. PRIVATE KEY + PUBLIC ADDRESS  


ACTIVE ADDRESSES - ADDRESSES WE FIND MONITORING THE CHAIN, THAT HAVE A BALANCE ABOVE X


SIMILAR ADDRESSES - WHERE WE STORE PAIRS THAT HAVE THE SAME STARTING 4 CHARACTERS (ACTIVE ADDRESS+OUR GENERATED PUBLIC KEY) 


TARGET - PEOPLE WHO HAVE INTERACTED WITH ACTIVE ADDRESSES THAT WE HAVE A SIMILAR ADDRESS TO


currently building the automatic sender. need help with the storing of active accounts. currently it is kind of shit, a lot of vote accounts.
