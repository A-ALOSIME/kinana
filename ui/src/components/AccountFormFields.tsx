import * as React from "react";
import { Dices } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { PasswordStrengthIndicator } from "@/components/ui/password-strength-indicator";
import type { AccountFormMode } from "@/accountForm";

export interface AccountFormFieldsProps {
  mode: AccountFormMode;
  isEdit: boolean;
  idPrefix: "add" | "edit";
  cardPreviewBadge: string;

  // Shared label & notes
  label: string;
  onLabelChange: (val: string) => void;
  notes: string;
  onNotesChange: (val: string) => void;

  // Login account fields
  username: string;
  onUsernameChange: (val: string) => void;
  email: string;
  onEmailChange: (val: string) => void;
  password: string;
  onPasswordChange: (val: string) => void;
  showPassword: boolean;
  onToggleShowPassword: () => void;
  onGeneratePassword: () => void;
  recoveryKey: string;
  onRecoveryKeyChange: (val: string) => void;
  showRecoveryKey: boolean;
  onToggleShowRecoveryKey: () => void;
  url: string;
  onUrlChange: (val: string) => void;

  // Bank card fields
  cardHolder: string;
  onCardHolderChange: (val: string) => void;
  cardNumber: string;
  onCardNumberChange: (val: string) => void;
  showCardNumber: boolean;
  onToggleShowCardNumber: () => void;
  cardExpiry: string;
  onCardExpiryChange: (val: string) => void;
  cardCvv: string;
  onCardCvvChange: (val: string) => void;
  showCardCvv: boolean;
  onToggleShowCardCvv: () => void;
  cardPin: string;
  onCardPinChange: (val: string) => void;
  showCardPin: boolean;
  onToggleShowCardPin: () => void;

  // Edit-only existing-secret & clearing flags (never preload plaintext into React state)
  hasExistingPassword?: boolean;
  revealedStoredPassword?: string | null;
  onCopyPassword?: () => void;
  copiedPassword?: boolean;
  hasExistingRecoveryKey?: boolean;
  revealedStoredRecoveryKey?: string | null;
  onCopyRecoveryKey?: () => void;
  copiedRecoveryKey?: boolean;
  revealedStoredCardNumber?: string | null;
  onCopyCardNumber?: () => void;
  copiedCardNumber?: boolean;
  revealedStoredCardCvv?: string | null;
  onCopyCardCvv?: () => void;
  copiedCardCvv?: boolean;
  hasExistingPin?: boolean;
  revealedStoredCardPin?: string | null;
  onCopyCardPin?: () => void;
  copiedCardPin?: boolean;
  clearRecoveryKey?: boolean;
  onSetClearRecoveryKey?: (clear: boolean) => void;
  clearCardPin?: boolean;
  onSetClearCardPin?: (clear: boolean) => void;
}

export const AccountFormFields: React.FC<AccountFormFieldsProps> = ({
  mode,
  isEdit,
  idPrefix,
  cardPreviewBadge,
  label,
  onLabelChange,
  notes,
  onNotesChange,
  username,
  onUsernameChange,
  email,
  onEmailChange,
  password,
  onPasswordChange,
  showPassword,
  onToggleShowPassword,
  onGeneratePassword,
  recoveryKey,
  onRecoveryKeyChange,
  showRecoveryKey,
  onToggleShowRecoveryKey,
  url,
  onUrlChange,
  cardHolder,
  onCardHolderChange,
  cardNumber,
  onCardNumberChange,
  showCardNumber,
  onToggleShowCardNumber,
  cardExpiry,
  onCardExpiryChange,
  cardCvv,
  onCardCvvChange,
  showCardCvv,
  onToggleShowCardCvv,
  cardPin,
  onCardPinChange,
  showCardPin,
  onToggleShowCardPin,
  hasExistingPassword = false,
  revealedStoredPassword = null,
  onCopyPassword,
  copiedPassword = false,
  hasExistingRecoveryKey = false,
  revealedStoredRecoveryKey = null,
  onCopyRecoveryKey,
  copiedRecoveryKey = false,
  revealedStoredCardNumber = null,
  onCopyCardNumber,
  copiedCardNumber = false,
  revealedStoredCardCvv = null,
  onCopyCardCvv,
  copiedCardCvv = false,
  hasExistingPin = false,
  revealedStoredCardPin = null,
  onCopyCardPin,
  copiedCardPin = false,
  clearRecoveryKey = false,
  onSetClearRecoveryKey,
  clearCardPin = false,
  onSetClearCardPin,
}) => {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.dir() !== "ltr";
  const ltrFieldAlign: React.CSSProperties = {
    direction: "ltr",
    textAlign: isRtl ? "right" : "left",
  };

  if (mode === "card") {
    return (
      <div className="space-y-4">
        {/* Live Bank Card Preview */}
        <div className="relative rounded-2xl p-5 sm:p-6 shadow-xl border border-white/10 overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white max-w-md mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-7 rounded bg-gradient-to-br from-amber-300 to-yellow-600 p-0.5 border border-yellow-200/50 shadow-inner flex flex-col justify-between shrink-0">
                <div className="h-1.5 border-b border-amber-600/40" />
                <div className="h-1.5 border-b border-amber-600/40" />
              </div>
              <span className="text-xs font-bold text-slate-300 truncate leading-relaxed py-0.5">
                {label || t("card.defaultLabel")}
              </span>
            </div>
            <Badge className="px-2.5 py-0.5 text-[10px] font-black tracking-wider bg-white/10 text-white border border-white/20 shrink-0">
              {cardPreviewBadge}
            </Badge>
          </div>

          <div
            className="my-4 font-mono text-lg sm:text-xl font-bold tracking-[0.2em] text-center text-white/90 select-none"
            dir="ltr"
          >
            {cardNumber ? cardNumber : "•••• •••• •••• ••••"}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-300 pt-2 border-t border-white/10">
            <div className="text-start">
              <span className="text-[9px] tracking-normal text-slate-400 block font-bold">
                {t("card.holderLabel")}
              </span>
              <span
                dir="auto"
                className="font-bold tracking-normal uppercase text-white truncate max-w-[160px] block leading-relaxed py-0.5"
              >
                {cardHolder || "CARDHOLDER NAME"}
              </span>
            </div>
            <div className="text-end">
              <span className="text-[9px] tracking-normal text-slate-400 block font-bold">
                {t("card.expiryLabel")}
              </span>
              <span dir="ltr" className="font-mono font-bold text-white block">
                {cardExpiry || "MM/YY"}
              </span>
            </div>
          </div>
        </div>

        <div>
          <FormLabel htmlFor={`${idPrefix}-card-label`}>
            {t("accountForm.card.label")}
          </FormLabel>
          <Input
            id={`${idPrefix}-card-label`}
            placeholder={t("accountForm.card.labelPlaceholder")}
            value={label}
            onChange={(e) => onLabelChange(e.target.value)}
            className="min-h-12 text-base px-4 font-sans font-bold rounded-xl border-2"
          />
        </div>

        <div>
          <FormLabel htmlFor={`${idPrefix}-card-holder`}>
            {t("accountForm.card.holderLabel")}
            {isRtl && (
              <>
                {" "}(<bdi dir="ltr">Cardholder Name</bdi>)
              </>
            )}
          </FormLabel>
          <Input
            id={`${idPrefix}-card-holder`}
            placeholder={t("accountForm.card.holderPlaceholder")}
            value={cardHolder}
            onChange={(e) => onCardHolderChange(e.target.value.toUpperCase())}
            className="min-h-12 text-base px-4 font-sans font-bold rounded-xl border-2 uppercase"
          />
        </div>

        <div>
          <FormLabel htmlFor={`${idPrefix}-card-number`} required={!isEdit}>
            {isEdit
              ? t("accountForm.card.numberLabelEdit")
              : t("accountForm.card.numberLabel")}
          </FormLabel>
          <SecretInput
            id={`${idPrefix}-card-number`}
            revealed={showCardNumber}
            onToggleReveal={onToggleShowCardNumber}
            revealLabel={t("accountForm.card.showNumber")}
            hideLabel={t("accountForm.card.hideNumber")}
            centered
            codeStyleWhenFilled
            filledTrackingClass="tracking-widest"
            storedSecretMask={isEdit && hasExistingPassword && !cardNumber}
            revealedStoredValue={isEdit ? revealedStoredCardNumber : null}
            onCopy={onCopyCardNumber}
            copied={copiedCardNumber}
            copyLabel={t("accountForm.card.copyNumber")}
            copiedLabel={t("accountForm.card.copiedNumber")}
            style={{ direction: "ltr", textAlign: "center" }}
            value={cardNumber}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, "").slice(0, 16);
              const formatted = raw.replace(/(\d{4})(?=\d)/g, "$1 ");
              onCardNumberChange(formatted);
            }}
            className="text-lg font-bold rounded-xl border-2 text-center"
            required={!isEdit}
          />
          {isEdit && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {t("accountForm.card.numberKeepHint")}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FormLabel htmlFor={`${idPrefix}-card-expiry`}>
              {t("accountForm.card.expiryLabel")} (<bdi dir="ltr">MM/YY</bdi>)
            </FormLabel>
            <Input
              id={`${idPrefix}-card-expiry`}
              value={cardExpiry}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, "").slice(0, 4);
                const formatted =
                  raw.length >= 3 ? `${raw.slice(0, 2)}/${raw.slice(2)}` : raw;
                onCardExpiryChange(formatted);
              }}
              style={{ direction: "ltr", textAlign: "center" }}
              className="min-h-12 text-base px-4 font-mono font-bold rounded-xl border-2 text-center"
            />
          </div>

          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 mb-1.5">
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <FormLabel htmlFor={`${idPrefix}-card-cvv`} inline className="mb-0">
                  {t("accountForm.card.cvvLabel")} (<bdi dir="ltr">CVV / CVC</bdi>)
                </FormLabel>
                <span className="text-xs text-muted-foreground font-normal">
                  ({t("accountForm.card.cvvDigitsHint")})
                </span>
              </div>
              {isEdit && hasExistingRecoveryKey && onSetClearRecoveryKey && (
                clearRecoveryKey ? (
                  <button
                    type="button"
                    onClick={() => onSetClearRecoveryKey(false)}
                    className="text-xs text-amber-400 hover:text-amber-300 font-bold shrink-0 self-center"
                  >
                    {t("accountForm.card.cvvRemovePending")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onSetClearRecoveryKey(true);
                      onCardCvvChange("");
                    }}
                    className="text-xs text-rose-400 hover:text-rose-300 font-bold shrink-0 self-center"
                  >
                    {t("accountForm.card.cvvRemove")} <bdi dir="ltr">CVV</bdi>
                  </button>
                )
              )}
            </div>
            <SecretInput
              id={`${idPrefix}-card-cvv`}
              revealed={showCardCvv}
              onToggleReveal={onToggleShowCardCvv}
              revealLabel={t("accountForm.card.showCvv")}
              hideLabel={t("accountForm.card.hideCvv")}
              centered
              codeStyleWhenFilled
              filledTrackingClass="tracking-widest"
              storedSecretMask={isEdit && hasExistingRecoveryKey && !cardCvv}
              revealedStoredValue={isEdit && !clearRecoveryKey ? revealedStoredCardCvv : null}
              onCopy={onCopyCardCvv}
              copied={copiedCardCvv}
              copyLabel={t("accountForm.card.copyCvv")}
              copiedLabel={t("accountForm.card.copiedCvv")}
              disabled={isEdit && clearRecoveryKey}
              value={isEdit && clearRecoveryKey ? "" : cardCvv}
              onChange={(e) =>
                onCardCvvChange(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              className={`text-base font-bold rounded-xl border-2 ${
                isEdit && clearRecoveryKey ? "opacity-50 line-through bg-destructive/10" : ""
              }`}
            />
            {isEdit && (
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {clearRecoveryKey
                  ? t("accountForm.card.cvvClearOnSave")
                  : t("accountForm.card.cvvKeepHint")}
              </p>
            )}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1.5">
            <FormLabel htmlFor={`${idPrefix}-card-pin`} inline className="mb-0">
              {t("accountForm.card.pinLabel")}
              {isRtl && (
                <>
                  {" "}(<bdi dir="ltr">PIN</bdi>)
                </>
              )}
            </FormLabel>
            {isEdit && hasExistingPin && onSetClearCardPin && (
              clearCardPin ? (
                <button
                  type="button"
                  onClick={() => onSetClearCardPin(false)}
                  className="text-xs text-amber-400 hover:text-amber-300 font-bold shrink-0 self-center"
                >
                  {t("accountForm.card.pinRemovePending")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onSetClearCardPin(true);
                    onCardPinChange("");
                  }}
                  className="text-xs text-rose-400 hover:text-rose-300 font-bold shrink-0 self-center"
                >
                  {t("accountForm.card.pinRemove")}
                </button>
              )
            )}
          </div>
          <SecretInput
            id={`${idPrefix}-card-pin`}
            revealed={showCardPin}
            onToggleReveal={onToggleShowCardPin}
            revealLabel={t("accountForm.card.showPin")}
            hideLabel={t("accountForm.card.hidePin")}
            centered
            codeStyleWhenFilled
            filledTrackingClass="tracking-widest"
            storedSecretMask={isEdit && hasExistingPin && !cardPin}
            revealedStoredValue={isEdit && !clearCardPin ? revealedStoredCardPin : null}
            onCopy={onCopyCardPin}
            copied={copiedCardPin}
            copyLabel={t("accountForm.card.copyPin")}
            copiedLabel={t("accountForm.card.copiedPin")}
            disabled={isEdit && clearCardPin}
            value={isEdit && clearCardPin ? "" : cardPin}
            onChange={(e) =>
              onCardPinChange(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            className={`text-base font-bold rounded-xl border-2 ${
              isEdit && clearCardPin ? "opacity-50 line-through bg-destructive/10" : ""
            }`}
          />
          {isEdit && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {clearCardPin
                ? t("accountForm.card.pinClearOnSave")
                : t("accountForm.card.pinKeepHint")}
            </p>
          )}
        </div>

        <div>
          <FormLabel htmlFor={`${idPrefix}-card-notes`}>
            {t("accountForm.card.notesLabel")}
          </FormLabel>
          <Input
            id={`${idPrefix}-card-notes`}
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            className="min-h-12 text-base px-4 font-sans font-bold rounded-xl border-2"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <FormLabel htmlFor={`${idPrefix}-acc-label`}>
          {t("accountForm.login.label")}
        </FormLabel>
        <Input
          id={`${idPrefix}-acc-label`}
          placeholder={t("accountForm.login.labelPlaceholder")}
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          className="min-h-12 text-base px-4 font-sans font-bold rounded-xl border-2"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <FormLabel htmlFor={`${idPrefix}-acc-username`}>
            {t("accountForm.login.usernameLabel")}
          </FormLabel>
          <Input
            id={`${idPrefix}-acc-username`}
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            className="min-h-12 text-base px-4 font-sans font-bold rounded-xl border-2"
          />
        </div>

        <div>
          <FormLabel htmlFor={`${idPrefix}-acc-email`}>
            {t("accountForm.login.emailLabel")}
          </FormLabel>
          <Input
            id={`${idPrefix}-acc-email`}
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            style={ltrFieldAlign}
            className="min-h-12 text-base px-4 font-sans font-bold rounded-xl border-2"
          />
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1.5">
          <FormLabel htmlFor={`${idPrefix}-acc-password`} inline className="mb-0">
            {isEdit
              ? t("accountForm.login.passwordLabelEdit")
              : t("accountForm.login.passwordLabel")}
          </FormLabel>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onGeneratePassword}
            className="h-9 px-3 text-xs font-bold gap-1.5 rounded-lg border-primary/50 text-primary hover:bg-primary/10 shrink-0"
          >
            <Dices className="w-4 h-4" />
            <span>
              {isEdit
                ? t("accountForm.login.generateNew")
                : t("accountForm.login.generateStrong")}
            </span>
          </Button>
        </div>
        <SecretInput
          id={`${idPrefix}-acc-password`}
          revealed={showPassword}
          onToggleReveal={onToggleShowPassword}
          revealLabel={t("accountForm.login.showPassword")}
          hideLabel={t("accountForm.login.hidePassword")}
          storedSecretMask={isEdit && hasExistingPassword && password.length === 0}
          revealedStoredValue={isEdit ? revealedStoredPassword : null}
          onCopy={onCopyPassword}
          copied={copiedPassword}
          copyLabel={t("accountForm.login.copyPassword")}
          copiedLabel={t("accountForm.login.copiedPassword")}
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          className="text-base font-bold rounded-xl border-2"
        />
        {password.length > 0 && (
          <PasswordStrengthIndicator password={password} className="mt-2" />
        )}
        {isEdit && (
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            {password.length > 0
              ? hasExistingPassword
                ? t("accountForm.login.passwordReplaceHint")
                : t("accountForm.login.passwordNewHint")
              : hasExistingPassword
                ? t("accountForm.login.passwordKeepHint")
                : t("accountForm.login.passwordNoneHint")}
          </p>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1.5">
          <FormLabel htmlFor={`${idPrefix}-acc-recovery`} inline className="mb-0">
            {t("accountForm.login.recoveryKeyLabel")}
            {isRtl && (
              <>
                {" "}(<bdi dir="ltr">Recovery Key</bdi>)
              </>
            )}
          </FormLabel>
          {isEdit && hasExistingRecoveryKey && onSetClearRecoveryKey && (
            clearRecoveryKey ? (
              <button
                type="button"
                onClick={() => onSetClearRecoveryKey(false)}
                className="text-xs text-amber-400 hover:text-amber-300 font-bold shrink-0 self-center"
              >
                {t("accountForm.login.recoveryRemovePending")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onSetClearRecoveryKey(true);
                  onRecoveryKeyChange("");
                }}
                className="text-xs text-rose-400 hover:text-rose-300 font-bold shrink-0 self-center"
              >
                {t("accountForm.login.recoveryRemove")}
              </button>
            )
          )}
        </div>
        <SecretInput
          id={`${idPrefix}-acc-recovery`}
          revealed={showRecoveryKey}
          onToggleReveal={onToggleShowRecoveryKey}
          revealLabel={t("accountForm.login.showRecoveryKey")}
          hideLabel={t("accountForm.login.hideRecoveryKey")}
          storedSecretMask={isEdit && hasExistingRecoveryKey && !recoveryKey}
          revealedStoredValue={isEdit && !clearRecoveryKey ? revealedStoredRecoveryKey : null}
          onCopy={onCopyRecoveryKey}
          copied={copiedRecoveryKey}
          copyLabel={t("accountForm.login.copyRecoveryKey")}
          copiedLabel={t("accountForm.login.copiedRecoveryKey")}
          disabled={isEdit && clearRecoveryKey}
          value={isEdit && clearRecoveryKey ? "" : recoveryKey}
          onChange={(e) => onRecoveryKeyChange(e.target.value)}
          className={`text-base font-bold rounded-xl border-2 ${
            isEdit && clearRecoveryKey ? "opacity-50 line-through bg-destructive/10" : ""
          }`}
        />
        {isEdit && (
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {clearRecoveryKey
              ? t("accountForm.login.recoveryClearOnSave")
              : t("accountForm.login.recoveryKeepHint")}
          </p>
        )}
      </div>

      <div>
        <FormLabel htmlFor={`${idPrefix}-acc-url`}>
          {t("accountForm.login.urlLabel")}
          {isRtl && (
            <>
              {" "}(<bdi dir="ltr">URL</bdi>)
            </>
          )}
        </FormLabel>
        <Input
          id={`${idPrefix}-acc-url`}
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          style={ltrFieldAlign}
          className="min-h-12 text-base px-4 font-sans font-bold rounded-xl border-2"
        />
      </div>

      <div>
        <FormLabel htmlFor={`${idPrefix}-acc-notes`}>
          {t("accountForm.login.notesLabel")}
        </FormLabel>
        <Input
          id={`${idPrefix}-acc-notes`}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          className="min-h-12 text-base px-4 font-sans font-bold rounded-xl border-2"
        />
      </div>
    </div>
  );
};
