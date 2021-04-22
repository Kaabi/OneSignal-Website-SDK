import { NotSubscribedError, NotSubscribedReason } from "../../../errors/NotSubscribedError";
import Log from "../../../libraries/Log";
import { EmailProfile } from "../../../models/EmailProfile";
import { SecondaryChannelProfile } from "../../../models/SecondaryChannelProfile";
import OneSignalApi from "../../../OneSignalApi";
import Database from "../../../services/Database";
import { SecondaryChannel, SecondaryChannelWithControllerEvents } from "./SecondaryChannel";
import { SecondaryChannelController } from "./SecondaryChannelController";
import { SecondaryChannelIdentifierUpdater } from "./updaters/SecondaryChannelIdentifierUpdater";
import { SecondaryChannelTagsUpdater } from "./updaters/SecondaryChannelTagsUpdater";
import { SecondaryChannelExternalUserIdUpdater } from "./updaters/SecondaryChannelExternalUserIdUpdater";
import { SecondaryChannelFocusUpdater } from "./updaters/SecondaryChannelFocusUpdater";
import { SecondaryChannelSessionUpdater } from "./updaters/SecondaryChannelSessionUpdater";
import { TagsObject } from "../../../models/Tags";

export class SecondaryChannelEmail implements SecondaryChannel, SecondaryChannelWithControllerEvents {

  constructor(
    readonly secondaryChannelController: SecondaryChannelController,
    readonly secondaryChannelIdentifierUpdater: SecondaryChannelIdentifierUpdater,
    readonly secondaryChannelExternalUserIdUpdater: SecondaryChannelExternalUserIdUpdater,
    readonly secondaryChannelTagsUpdater: SecondaryChannelTagsUpdater,
    readonly secondaryChannelSessionUpdater: SecondaryChannelSessionUpdater,
    readonly secondaryChannelFocusUpdater: SecondaryChannelFocusUpdater,
    ) {
    secondaryChannelController.registerChannel(this);
  }

  async logout(): Promise<boolean> {
    // TODO: Explain that email has a REST API logout with parent_player_id
    const { deviceId } = await Database.getSubscription();
    if (!deviceId) {
      Log.warn(new NotSubscribedError(NotSubscribedReason.NoDeviceId));
      return false;
    }

    const emailProfile = await Database.getEmailProfile();
    if (!emailProfile.subscriptionId) {
      Log.warn(new NotSubscribedError(NotSubscribedReason.NoEmailSet));
      return false;
    }

    const appConfig = await Database.getAppConfig();

    if (!await OneSignalApi.logoutEmail(appConfig, emailProfile, deviceId)) {
      Log.warn("Failed to logout email.");
      return false;
    }

    await Database.setEmailProfile(new EmailProfile());
    return true;
  }

  async setIdentifier(identifier: string, authHash?: string): Promise<string | null> {
    const profileProvider = this.secondaryChannelIdentifierUpdater.profileProvider;
    const existingEmailProfile = await profileProvider.getProfile();
    const newEmailSubscriptionId = await this.secondaryChannelIdentifierUpdater.setIdentifier(identifier, authHash);

    if (newEmailSubscriptionId) {
      const newEmailProfile = profileProvider.newProfile(newEmailSubscriptionId, identifier);
      await this.updatePushPlayersRelationToEmailPlayer(existingEmailProfile, newEmailProfile);
    }

    return newEmailSubscriptionId;
  }

  private async updatePushPlayersRelationToEmailPlayer(
    existingEmailProfile: SecondaryChannelProfile,
    newEmailProfile: SecondaryChannelProfile): Promise<void> {

    const { deviceId } = await Database.getSubscription();
    // If we are subscribed to web push
    const isExistingPushRecordSaved = deviceId;
    // And if we previously saved an email ID and it's different from the new returned ID
    const isExistingEmailSaved = !!existingEmailProfile.subscriptionId;
    const emailPreviouslySavedAndDifferent = !isExistingEmailSaved ||
      existingEmailProfile.subscriptionId !== newEmailProfile.subscriptionId;
    // Or if we previously saved an email and the email changed
    const emailPreviouslySavedAndChanged = !existingEmailProfile.identifier ||
      newEmailProfile.identifier !== existingEmailProfile.identifier;

    if (!!deviceId && isExistingPushRecordSaved && (emailPreviouslySavedAndDifferent || emailPreviouslySavedAndChanged))
      {
        const authHash = await OneSignal.database.getExternalUserIdAuthHash();
        const appConfig = await Database.getAppConfig();
        // Then update the push device record with a reference to the new email ID and email address
        await OneSignalApi.updatePlayer(
          appConfig.appId,
          deviceId,
          {
            parent_player_id: newEmailProfile.subscriptionId,
            email: newEmailProfile.identifier,
            external_user_id_auth_hash: authHash
          }
        );
    }
  }

  async onSession(): Promise<void> {
    await this.secondaryChannelSessionUpdater.sendOnSession();
  }
  async onFocus(sessionDuration: number): Promise<void> {
    await this.secondaryChannelFocusUpdater.sendOnFocus(sessionDuration);
  }
  async setTags(tags: TagsObject<any>): Promise<void> {
    await this.secondaryChannelTagsUpdater.sendTags(tags);
  }

  async setExternalUserId(id: string, authHash?: string): Promise<void> {
    await this.secondaryChannelExternalUserIdUpdater.setExternalUserId(id, authHash);
  }

}
