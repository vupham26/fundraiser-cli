'use strict'

const readline = require('readline')
const { bold, cyan, red, green } = require('chalk')
const { prompt } = require('inquirer')
const createSpinner = require('ora')
const promisify = require('bluebird').promisify
const cfr = require('cosmos-fundraiser')
const { FUNDRAISER_CONTRACT } = cfr.ethereum
cfr.fetchStatus = promisify(cfr.fetchStatus)
cfr.bitcoin.pushTx = promisify(cfr.bitcoin.pushTx)
cfr.bitcoin.fetchFeeRate = promisify(cfr.bitcoin.fetchFeeRate)
cfr.bitcoin.waitForPayment = promisify(cfr.bitcoin.waitForPayment)
cfr.ethereum.fetchAtomRate = promisify(cfr.ethereum.fetchAtomRate)

async function main () {
  console.log(cyan(`
 .d8888b.   .d88888b.   .d8888b.  888b     d888  .d88888b.   .d8888b.
d88P  Y88b d88P" "Y88b d88P  Y88b 8888b   d8888 d88P" "Y88b d88P  Y88b
888    888 888     888 Y88b.      88888b.d88888 888     888 Y88b.
888        888     888  "Y888b.   888Y88888P888 888     888  "Y888b.
888        888     888     "Y88b. 888 Y888P 888 888     888     "Y88b.
888    888 888     888       "888 888  Y8P  888 888     888       "888
Y88b  d88P Y88b. .d88P Y88b  d88P 888   "   888 Y88b. .d88P Y88b  d88P
 "Y8888P"   "Y88888P"   "Y8888P"  888       888  "Y88888P"   "Y8888P"
`),
`

Welcome to the Cosmos Fundraiser!

Thank you for your interest in donating funds for the development of The Cosmos Network.
Let's get started!
  `)

  await checkFundraiserStatus()

  let wallet = await createOrInputWallet()
  let currency = await promptForCurrency()
  if (currency === 'BTC') {
    let tx = await waitForBtcTx(wallet.addresses.bitcoin)
    await finalizeBtcDonation(wallet, tx)
  } else {
    await makeEthDonation(wallet)
  }
}

async function checkFundraiserStatus () {
  let spinner = createSpinner('Checking fundraiser status...')
  let status = await cfr.fetchStatus()
  spinner.stop()
  if (!status.fundraiserEnded) return
  let { donateAnyway } = await prompt({
    type: 'confirm',
    name: 'donateAnyway',
    message: red(`NOTICE: The fundraiser has ended or has not yet started.
You may still donate, but you will NOT receive Atoms.
Continue anyway?`)
  })
  if (!donateAnyway) process.exit(0)
  console.log()
}

async function createOrInputWallet () {
  let choices = [ 'Generate wallet', 'Input existing wallet' ]
  let { action } = await prompt({
    type: 'list',
    choices,
    name: 'action',
    message: 'Generate a new wallet, or use an existing one?'
  })
  let generate = choices[0]
  if (action === generate) {
    return await createWallet()
  } else {
    return await inputWallet()
  }
}

async function createWallet () {
  let seed = cfr.generateMnemonic()

  let walletString = `
Let's generate your Cosmos wallet. You will need this in the future to
access your Atoms.

Here is your wallet:

${green(seed.toString('hex'))}

${red(`WRITE THIS DOWN AND DO NOT LOSE IT!`)}

${red(`IF YOU LOSE THIS WALLET YOU LOSE YOUR ATOMS!`)}

${red(`WARNING: DO NOT LOSE YOUR WALLET!`)}
${red(`WARNING: DO NOT LOSE YOUR WALLET!`)}
${red(`WARNING: DO NOT LOSE YOUR WALLET!`)}
  \n`

  console.log(walletString)

  await prompt({
    name: 'write-wallet',
    message: 'Please write down your wallet, then continue.'
  })

  let walletStringLength = walletString.split(/\r\n|\r|\n/).length
  readline.moveCursor(process.stdout, 0, -walletStringLength)
  readline.clearScreenDown(process.stdout)

  while (true) {
        let { reinput } = await prompt({
          name: 'reinput',
          message: 'Please re-enter your 12-word wallet phrase:'
        })
	if (reinput.trim() == seed){
		return cfr.deriveWallet(seed)
	}
	console.log("Incorrect. Try again or exit and restart")
  }
}

async function inputWallet () {
  let { seed } = await prompt({
    name: 'seed',
    message: 'Please enter your 12-word wallet phrase:'
  })
  return cfr.deriveWallet(seed)
}

async function promptForCurrency () {
  let { currency } = await prompt({
    type: 'list',
    choices: [ 'BTC', 'ETH' ],
    name: 'currency',
    message: 'Which currency will you make your donation in?'
  })
  return currency
}

async function waitForBtcTx (address) {
  console.log(`
${bold('Suggested allocation rate:')} 1 BTC : ${cfr.bitcoin.ATOMS_PER_BTC} ATOM
${bold('Minimum donation:')} ${cfr.bitcoin.MINIMUM_AMOUNT / 1e8} BTC

Your intermediate Bitcoin address is:
${cyan(address)}

Send BTC to this address to continue with your contribution.
This address is owned by you, so you can get the coins back if you
change your mind.
  `)
  let spinner = createSpinner('Waiting for a transaction...').start()
  let inputs = await cfr.bitcoin.waitForPayment(address)
  spinner.succeed('Got payment of ' + cyan(`${inputs.amount / 1e8} BTC`))
  return inputs
}

async function finalizeBtcDonation (wallet, inputs) {
  let feeSpinner = createSpinner('Fetching BTC transaction fee rate...')
  let feeRate = await cfr.bitcoin.fetchFeeRate()
  feeSpinner.stop()
  let finalTx = cfr.bitcoin.createFinalTx(inputs.utxos, feeRate)
  console.log(`
Ready to finalize contribution:
  ${bold('Donating:')} ${finalTx.paidAmount / 1e8} BTC
  ${bold('Bitcoin transaction fee:')} ${finalTx.feeAmount / 1e8} BTC
  ${bold('Suggested Atom Equivalent:')} ${finalTx.atomAmount} ATOM
  ${bold('Cosmos address:')} ${wallet.addresses.cosmos}
  `)

  let { agree } = await prompt({
    type: 'confirm',
    name: 'agree',
    message: 'Have you read and agreed to the Terms of Service and Donation Agreement?',
    default: false
  })
  if (!agree) {
    console.log(red(`
You can read the Terms of Service and Donation Agreement here:
https://github.com/cosmos/cosmos/blob/master/fundraiser/Interchain%20Cosmos%20Contribution%20Terms%20-%20FINAL.pdf
    `))
    return
  }

  let { confirm } = await prompt({
    type: 'confirm',
    name: 'confirm',
    message: 'Finalize contribution? You will NOT be able undo this transaction:',
    default: false
  })
  if (!confirm) return

  let signedTx = cfr.bitcoin.signFinalTx(wallet, finalTx.tx)

  let spinner = createSpinner('Broadcasting transaction...')
  await cfr.bitcoin.pushTx(signedTx.toHex())
  spinner.succeed('Transaction sent!')
  let txid = signedTx.getId()
  console.log('Bitcoin TXID: ' + cyan(txid))
  console.log('Thank you for participating in the Cosmos fundraiser!')
}

async function makeEthDonation (wallet) {
  let tx = cfr.ethereum.getTransaction(
    `${wallet.addresses.cosmos}`,
    wallet.addresses.ethereum
  )
  let spinner = createSpinner('Fetching ATOM/ETH exchange rate...')
  let weiPerAtom = await cfr.ethereum.fetchAtomRate(FUNDRAISER_CONTRACT)
  let atomPerEth = Math.pow(10, 18) / weiPerAtom
  spinner.stop()
  console.log(`
  ${bold('Suggested allocation rate:')} 1 ETH : ${atomPerEth} ATOM
  ${bold('Minimum donation:')} ${cfr.ethereum.MIN_DONATION} ETH
  ${bold('Your Cosmos address:')} ${wallet.addresses.cosmos} (DO NOT SEND ETHER HERE!)

Here's your donation transaction:
${cyan('  ' + JSON.stringify(tx, null, '    ').replace('}', '  }'))}

To make your donation, copy and paste this information into a wallet
such as MyEtherWallet or Mist. Be sure to include an amount of ETH to
donate! Your Cosmos address is included in the data, and the donation
will be recorded for that address in the smart contract.

Thank you for participating in the Cosmos Fundraiser!
  `)
}

module.exports = main
