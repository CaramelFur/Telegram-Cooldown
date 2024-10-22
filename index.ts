import normalFS from 'node:fs';
import fs from 'node:fs/promises';
import readline from 'node:readline';

import dotenv from 'dotenv';
import { Api, TelegramClient } from 'telegram';
import { NewMessage } from 'telegram/events/index.js';
import { StringSession } from 'telegram/sessions/index.js';
import { Muter } from './muter.ts';

dotenv.config();

const SESSION_LOCATION = process.env.SESSION_LOCATION ?? "./session.json";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const apiId = Number(process.env.API_ID);
const apiHash = String(process.env.API_HASH);

async function main() {
  console.log('Loading interactive example...');
  // Read string session from "./session.json"
  // Check if the file exists
  let stringSession;
  if (!normalFS.existsSync(SESSION_LOCATION)) {
    stringSession = new StringSession('');
  } else {
    const session = await fs.readFile(SESSION_LOCATION, 'utf-8');
    stringSession = new StringSession(session);
  }

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () =>
      new Promise((resolve) =>
        rl.question('Please enter your number: ', resolve),
      ),
    password: async () =>
      new Promise((resolve) =>
        rl.question('Please enter your password: ', resolve),
      ),
    phoneCode: async () =>
      new Promise((resolve) =>
        rl.question('Please enter the code you received: ', resolve),
      ),
    onError: (err) => console.log(err),
  });

  console.log('You should now be connected.');
  const savableSession = client.session.save() as any as string; // bruh
  await fs.writeFile(SESSION_LOCATION, savableSession);

  console.log('Session has been saved.');

  // Get the user id of the current account

  console.log('Feching important data...');

  const me = await client.getMe();
  await client.getDialogs();

  console.log('Logged in as', me.username);

  // Listen to messages
  client.addEventHandler(async (update) => {
    try {
      if (!update.message) return;
      const message = update.message;
      if (!message.peerId) return;
      if (message.fromId) {
        if (
          message.fromId.className === 'PeerUser' &&
          message.fromId.userId.equals(me.id)
        ) {
          console.log('Ignoring message from self');
          return;
        }
      }

      switch (message.peerId.className) {
        case 'PeerUser':
          const userID = Number(message.peerId.userId);
          console.log('Received message from user', userID);
          break;
        case 'PeerChat':
          await HandleChatMessage(client, message, message.peerId);
          break;
        case 'PeerChannel':
          await HandleChannelMessage(client, message, message.peerId);
          break;
        default:
          console.log('Received message in unknown chat');
      }
    } catch (e) {
      console.error(e);
    }
  }, new NewMessage({}));

  client.addEventHandler(async (update) => {
    if (update.className !== 'UpdateNotifySettings') return;
    try {
      await HandleNotifySettingsUpdate(
        client,
        update.peer,
        update.notifySettings,
      );
    } catch (e) {
      console.error(e);
    }
  });
}

const cachedMutedUntil: Record<string, number> = {};
const cachedChannelAccessHash: Record<string, bigInt.BigInteger> = {};

const muters: Record<string, Muter> = {};

async function HandleNotifySettingsUpdate(
  client: TelegramClient,
  peer: Api.NotifyPeer,
  notifySettings: Api.PeerNotifySettings,
) {
  let channelOrChatId: bigInt.BigInteger;
  if (peer.peer.className === 'PeerChat') {
    channelOrChatId = peer.peer.chatId;
  } else if (peer.peer.className === 'PeerChannel') {
    channelOrChatId = peer.peer.channelId;
  } else {
    return;
  }

  let mutedUntil = notifySettings.muteUntil ?? 0;
  if (notifySettings.silent === true) mutedUntil = 2147483647;

  cachedMutedUntil[channelOrChatId.toString()] = mutedUntil;

  console.log(
    'Updated muteUntil for',
    channelOrChatId.toString(),
    'to',
    mutedUntil,
  );
}

async function GetCachedOrFetchIsMuted(
  client: TelegramClient,
  peer: Api.PeerChannel | Api.PeerChat,
): Promise<boolean> {
  let channelOrChatId: bigInt.BigInteger;
  if (peer.className === 'PeerChat') {
    channelOrChatId = peer.chatId;
  } else if (peer.className === 'PeerChannel') {
    channelOrChatId = peer.channelId;
  } else {
    return false;
  }

  if (cachedMutedUntil[channelOrChatId.toString()]) {
    return cachedMutedUntil[channelOrChatId.toString()] > Date.now() / 1000;
  }

  if (peer.className === 'PeerChat') {
    const chat = await client.invoke(
      new Api.messages.GetFullChat({ chatId: peer.chatId }),
    );
    let muteUntil = chat.fullChat.notifySettings.muteUntil ?? 0;
    if (chat.fullChat.notifySettings.silent === true) muteUntil = 2147483647;
    cachedMutedUntil[channelOrChatId.toString()] = muteUntil;

    return muteUntil > Date.now() / 1000;
  } else if (peer.className === 'PeerChannel') {
    const chat = await client.invoke(
      new Api.channels.GetFullChannel({ channel: peer.channelId }),
    );
    cachedChannelAccessHash[channelOrChatId.toString()] = (
      chat.chats[0] as any
    ).accessHash;

    let muteUntil = chat.fullChat.notifySettings.muteUntil ?? 0;
    if (chat.fullChat.notifySettings.silent === true) muteUntil = 2147483647;
    cachedMutedUntil[channelOrChatId.toString()] = muteUntil;

    return muteUntil > Date.now() / 1000;
  } else {
    return false;
  }
}

async function GetCachedAccessHashForChannel(
  client: TelegramClient,
  channelId: bigInt.BigInteger,
): Promise<bigInt.BigInteger> {
  if (cachedChannelAccessHash[channelId.toString()]) {
    return cachedChannelAccessHash[channelId.toString()];
  }

  const chat = await client.invoke(
    new Api.channels.GetFullChannel({ channel: channelId }),
  );
  const accessHash: bigInt.BigInteger = (chat.chats[0] as any).accessHash;
  cachedChannelAccessHash[channelId.toString()] = accessHash;

  return accessHash;
}

async function HandleChatMessage(
  client: TelegramClient,
  message: Api.Message,
  peerId: Api.PeerChat,
) {
  const chatId = peerId.chatId;

  const muted = await GetCachedOrFetchIsMuted(client, peerId);
  if (muted) {
    //console.log('Chat is muted, not responding.');
    return;
  }

  console.log('Received message in chat', chatId);

  // Create muter if it doesn't exist
  if (!muters[chatId.toString()]) {
    muters[chatId.toString()] = new Muter();
  }
  const muter = muters[chatId.toString()];

  const muteUntil = muter.countMessage();
  if (muteUntil > 0) {
    console.log('Muting chat for 5 minutes');
    await client.invoke(
      new Api.account.UpdateNotifySettings({
        peer: new Api.InputNotifyPeer({
          peer: new Api.InputPeerChat({ chatId }),
        }),
        settings: new Api.InputPeerNotifySettings({
          muteUntil: muteUntil,
        }),
      }),
    );
    cachedMutedUntil[chatId.toString()] = muteUntil;
    await client.sendMessage('me', {
      message: `Muted chat ${chatId}`,
    });
  }
}

async function HandleChannelMessage(
  client: TelegramClient,
  message: Api.Message,
  peerId: Api.PeerChannel,
) {
  const channelId = peerId.channelId;

  const muted = await GetCachedOrFetchIsMuted(client, peerId);
  if (muted) {
    //console.log('Channel is muted, not responding.');
    return;
  }

  console.log('Received message in channel', channelId);

  // Create muter if it doesn't exist
  if (!muters[channelId.toString()]) {
    muters[channelId.toString()] = new Muter();
  }
  const muter = muters[channelId.toString()];

  const muteUntil = muter.countMessage();
  if (muteUntil > 0) {
    console.log('Muting channel for 5 minutes');
    const accessHash = await GetCachedAccessHashForChannel(client, channelId);

    await client.invoke(
      new Api.account.UpdateNotifySettings({
        peer: new Api.InputNotifyPeer({
          peer: new Api.InputPeerChannel({
            channelId,
            accessHash,
          }),
        }),
        settings: new Api.InputPeerNotifySettings({
          muteUntil: muteUntil,
        }),
      }),
    );
    cachedMutedUntil[channelId.toString()] = muteUntil;
    await client.sendMessage('me', {
      message: `Muted channel ${channelId}`,
    });
  }
}

main().catch(console.error);
