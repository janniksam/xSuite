// Code generated by the multiversx-sc build system. DO NOT EDIT.

////////////////////////////////////////////////////
////////////////// AUTO-GENERATED //////////////////
////////////////////////////////////////////////////

// Init:                                 1
// Upgrade:                              1
// Endpoints:                            6
// Async Callback (empty):               1
// Total number of exported functions:   9

#![no_std]

multiversx_sc_wasm_adapter::allocator!();
multiversx_sc_wasm_adapter::panic_handler!();

multiversx_sc_wasm_adapter::endpoints! {
    contract
    (
        init => init
        upgrade => upgrade
        createTransfer => create_transfer
        executeTransfer => execute_transfer
        cancelTransfer => cancel_transfer
        claimBalances => claim_balances
        getTransfers => get_transfers
        getAddressBalances => get_address_balances
    )
}

multiversx_sc_wasm_adapter::async_callback_empty! {}
