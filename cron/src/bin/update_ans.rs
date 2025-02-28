use abstract_interface::Abstract;
use cw_orch::{
    deploy::Deploy,
    prelude::{
        *,
        networks::{ChainInfo, parse_network},
    },
};
use tokio::runtime::Runtime;

fn update_ans() -> anyhow::Result<()> {
    let rt = Runtime::new()?;
    let deployment = Abstract::load_from(Mock::new(&Addr::unchecked("input")))?;
    // let chain_ids = deployment.get_all_deployed_chains();
    let chain_ids: Vec<String> = vec!["juno-1"].into_iter().map(|n| n.to_string()).collect();

    let networks: Vec<ChainInfo> = chain_ids.iter().map(|n| parse_network(n)).collect();

    for network in networks {
        let chain = DaemonBuilder::default()
            .handle(rt.handle())
            .chain(network)
            .build()?;

        let deployment = Abstract::load_from(chain)?;

        // Take the assets, contracts, and pools from resources and upload them to the ans host
        let ans_host = deployment.ans_host;
        // First we get all values
        let scraped_entries = script_helpers::get_scraped_entries(&ans_host)?;
        let on_chain_entries = script_helpers::get_on_chain_entries(&ans_host)?;

        // Then we create a diff between the 2 objects
        let diff = script_helpers::diff(scraped_entries, on_chain_entries)?;

        // Finally we upload on-chain
        script_helpers::update(&ans_host, diff)?;
    }
    Ok(())
}

fn main() {
    dotenv().ok();
    env_logger::init();

    use dotenv::dotenv;

    if let Err(ref err) = update_ans() {
        log::error!("{}", err);
        err.chain()
            .skip(1)
            .for_each(|cause| log::error!("because: {}", cause));

        // The backtrace is not always generated. Try to run this example
        // with `$env:RUST_BACKTRACE=1`.
        //    if let Some(backtrace) = e.backtrace() {
        //        log::debug!("backtrace: {:?}", backtrace);
        //    }

        ::std::process::exit(1);
    }
}
