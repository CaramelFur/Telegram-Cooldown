export class Muter {
  private TIMEWINDOW_INITIAL = 120;
  private TIMEWINDOW_COOLDOWN = 60 * 5;
  private LIMIT = 3;

  private lastCreatedAMuteUntil: number = 0;

  private messageCount: number = 0;
  private resetCallback: NodeJS.Timeout | null = null;

  constructor() {
    if (process.env.TIMEWINDOW_INITIAL) {
      this.TIMEWINDOW_INITIAL = Number(process.env.TIMEWINDOW_INITIAL);
    }
    if (process.env.TIMEWINDOW_COOLDOWN) {
      this.TIMEWINDOW_COOLDOWN = Number(process.env.TIMEWINDOW_COOLDOWN);
    }
    if (process.env.LIMIT) {
      this.LIMIT = Number(process.env.LIMIT);
    }
  }

  countMessage() {
    this.messageCount++;
    if (this.resetCallback) {
      clearTimeout(this.resetCallback);
    }

    // If still within 1 minute after the mute, immediately mute again
    if ((Date.now() / 1000) - this.lastCreatedAMuteUntil < this.TIMEWINDOW_INITIAL) {
      this.messageCount = this.LIMIT;
      console.log('Remuting chat');
    }

    this.resetCallback = setTimeout(() => {
      this.messageCount = 0;
      this.resetCallback = null;
    }, this.TIMEWINDOW_INITIAL * 1000);

    if (this.messageCount >= this.LIMIT) {
      this.lastCreatedAMuteUntil = Date.now() / 1000 + this.TIMEWINDOW_COOLDOWN;
      console.log('Muting chat for 5 minutes');
      return this.lastCreatedAMuteUntil;
    } else {
      return 0;
    }
  }
}
