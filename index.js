import MTProto from '@mtproto/core';
import dotenv from 'dotenv';
import prompts from 'prompts';

dotenv.config();

class API {
  constructor() {
    this.mtproto = new MTProto({
      api_id: process.env.API_ID,
      api_hash: process.env.API_HASH,

      storageOptions: {
        path: './data/1.json',
      },
    });
  }

  async call(method, params, options = {}) {
    try {
      const result = await this.mtproto.call(method, params, options);

      return result;
    } catch (error) {
      console.log(`${method} error:`, error);

      const { error_code, error_message } = error;

      if (error_code === 420) {
        const seconds = Number(error_message.split('FLOOD_WAIT_')[1]);
        const ms = seconds * 1000;

        await sleep(ms);

        return this.call(method, params, options);
      }

      if (error_code === 303) {
        const [type, dcIdAsString] = error_message.split('_MIGRATE_');

        const dcId = Number(dcIdAsString);

        // If auth.sendCode call on incorrect DC need change default DC, because
        // call auth.signIn on incorrect DC return PHONE_CODE_EXPIRED error
        if (type === 'PHONE') {
          await this.mtproto.setDefaultDc(dcId);
        } else {
          Object.assign(options, { dcId });
        }

        return this.call(method, params, options);
      }

      return Promise.reject(error);
    }
  }

  async getUser() {
    try {
      const user = await this.call('users.getFullUser', {
        id: {
          _: 'inputUserSelf',
        },
      });

      return user;
    } catch (error) {
      return null;
    }
  }

  sendCode(phone) {
    return this.call('auth.sendCode', {
      phone_number: phone,
      settings: {
        _: 'codeSettings',
      },
    });
  }

  signIn({ code, phone, phone_code_hash }) {
    return this.call('auth.signIn', {
      phone_code: code,
      phone_number: phone,
      phone_code_hash: phone_code_hash,
    });
  }

  signUp({ phone, phone_code_hash }) {
    return this.call('auth.signUp', {
      phone_number: phone,
      phone_code_hash: phone_code_hash,
      first_name: 'MTProto',
      last_name: 'Core',
    });
  }

  getPassword() {
    return this.call('account.getPassword');
  }

  checkPassword({ srp_id, A, M1 }) {
    return this.call('auth.checkPassword', {
      password: {
        _: 'inputCheckPasswordSRP',
        srp_id,
        A,
        M1,
      },
    });
  }
}

const api = new API();

async function login() {
  // Ask for phone numbe
  const { phone } = await prompts({
    type: 'text',
    name: 'phone',
    message: 'What is your phone number?',
  });

  // Send code
  const { phone_code_hash } = await api.sendCode(phone);

  // Ask for code
  const { code } = await prompts({
    type: 'text',
    name: 'code',
    message: 'What is your code?',
  });

  try {
    const signInResult = await api.signIn({
      code,
      phone,
      phone_code_hash,
    });

    if (signInResult._ === 'auth.authorizationSignUpRequired') {
      await api.signUp({
        phone,
        phone_code_hash,
      });
    }
  } catch (error) {
    if (error.error_message !== 'SESSION_PASSWORD_NEEDED') {
      console.log(`error:`, error);

      return;
    }

    // 2FA

    // Ask for password
    const { password } = await prompts({
      type: 'text',
      name: 'password',
      message: 'What is your password?',
    });

    const { srp_id, current_algo, srp_B } = await api.getPassword();
    const { g, p, salt1, salt2 } = current_algo;

    const { A, M1 } = await api.mtproto.crypto.getSRPParams({
      g,
      p,
      salt1,
      salt2,
      gB: srp_B,
      password,
    });

    const checkPasswordResult = await api.checkPassword({ srp_id, A, M1 });

    console.log('checkPasswordResult', checkPasswordResult);
  }
}

async function main() {
  // Log in
  const user = await api.getUser();
  if (!user) {
    await login();
  }

  let mtproto = api.mtproto;
  mtproto.updates.on('updatesTooLong', (updateInfo) => {
    console.log('updatesTooLong:', updateInfo);
  });
  
  mtproto.updates.on('updateShortMessage', (updateInfo) => {
    console.log('updateShortMessage:', updateInfo);
  });
  
  mtproto.updates.on('updateShortChatMessage', async (updateInfo) => {
    console.log('updateShortChatMessage:', updateInfo);
    // Fetch more details about the chat, like the title
    const chat = await api.call('messages.getFullChat', {
      chat_id: updateInfo.chat_id,
    });
    console.log('chat:', chat);
    
    
  });
  
  mtproto.updates.on('updateShort', (updateInfo) => {
    console.log('updateShort:', updateInfo);
  });
  
  mtproto.updates.on('updatesCombined', (updateInfo) => {
    console.log('updatesCombined:', updateInfo);
  });
  
  mtproto.updates.on('updates', (updateInfo) => {
    console.log('updates:', updateInfo);
  });
  
  mtproto.updates.on('updateShortSentMessage', (updateInfo) => {
    console.log('updateShortSentMessage:', updateInfo);
  });
}

main().catch(console.error);
