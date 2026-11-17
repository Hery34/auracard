import { flushSync } from "react-dom";

import { HTTPS_URL_MAX_LENGTH } from "@/domain/profile/https-url";
import { LINK_LABEL_MAX_LENGTH, LINK_PLATFORMS, MAX_LINKS, isLinkPlatform } from "@/domain/profile/link";
import type { EditorLink } from "@/ui/features/profile-editor/editor-state";
import { canAddLink, type LinkPatch } from "@/ui/features/profile-editor/link-list";
import { PUBLIC_NUMBER_NOTICE, type LinkFieldName } from "@/ui/features/profile-editor/messages";
import { PLATFORM_NAMES } from "@/ui/features/profile/platform-names";
import { PROTECTED_PLATFORMS } from "@/ui/features/profile/profile-card-view";
import { Button } from "@/ui/primitives/button";
import { Field } from "@/ui/primitives/field";
import { Label } from "@/ui/primitives/label";
import { Select } from "@/ui/primitives/select";

export type LinkActions = {
  add: () => string;
  update: (key: string, patch: LinkPatch) => void;
  remove: (key: string) => void;
  move: (key: string, offset: -1 | 1) => void;
};

type Props = {
  links: readonly EditorLink[];
  errors: Partial<Record<string, Partial<Record<LinkFieldName, string>>>>;
  listError: string | null;
  actions: LinkActions;
};

const ADD_BUTTON_ID = "link-add";

function controlId(key: string, control: string): string {
  return `link-${key}-${control}`;
}

/** Focus moves with the row (keyboard reordering), to the other arrow when this one became disabled. */
function focusAfterMove(key: string, offset: -1 | 1) {
  const same = document.getElementById(controlId(key, offset === -1 ? "up" : "down"));
  const other = document.getElementById(controlId(key, offset === -1 ? "down" : "up"));
  const target = same instanceof HTMLButtonElement && !same.disabled ? same : other;
  target?.focus();
}

export function LinkFields({ links, errors, listError, actions }: Props) {
  function move(key: string, offset: -1 | 1) {
    flushSync(() => actions.move(key, offset));
    focusAfterMove(key, offset);
  }

  function remove(key: string) {
    flushSync(() => actions.remove(key));
    document.getElementById(ADD_BUTTON_ID)?.focus();
  }

  function add() {
    let key = "";
    flushSync(() => {
      key = actions.add();
    });
    document.getElementById(controlId(key, "platform"))?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Liens</h2>
      {listError !== null && <p className="text-sm text-destructive">{listError}</p>}
      {links.map((link, index) => (
        <LinkFieldset
          key={link.key}
          link={link}
          position={index + 1}
          isFirst={index === 0}
          isLast={index === links.length - 1}
          errors={errors[link.key] ?? {}}
          onChange={(patch) => actions.update(link.key, patch)}
          onMove={(offset) => move(link.key, offset)}
          onRemove={() => remove(link.key)}
        />
      ))}
      <Button id={ADD_BUTTON_ID} type="button" variant="outline" disabled={!canAddLink(links)} onClick={add} className="self-start">
        Ajouter un lien
      </Button>
      {!canAddLink(links) && <p className="text-sm text-muted-foreground">{MAX_LINKS} liens au plus.</p>}
    </div>
  );
}

type FieldsetProps = {
  link: EditorLink;
  position: number;
  isFirst: boolean;
  isLast: boolean;
  errors: Partial<Record<LinkFieldName, string>>;
  onChange: (patch: LinkPatch) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
};

function LinkFieldset({ link, position, isFirst, isLast, errors, onChange, onMove, onRemove }: FieldsetProps) {
  const platformId = controlId(link.key, "platform");
  const platformErrorId = `${platformId}-error`;
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <legend className="px-1 font-semibold">Lien {position}</legend>
      <div className="flex flex-col gap-1">
        <Label htmlFor={platformId}>Plateforme</Label>
        <Select
          id={platformId}
          value={link.platform}
          aria-invalid={errors.platform === undefined ? undefined : true}
          aria-describedby={errors.platform === undefined ? undefined : platformErrorId}
          onChange={(event) => {
            if (isLinkPlatform(event.target.value)) {
              onChange({ platform: event.target.value });
            }
          }}
        >
          {LINK_PLATFORMS.map((platform) => (
            <option key={platform} value={platform}>
              {PLATFORM_NAMES[platform]}
            </option>
          ))}
        </Select>
        {errors.platform !== undefined && (
          <p id={platformErrorId} className="text-sm text-destructive">
            {errors.platform}
          </p>
        )}
      </div>
      <Field
        id={controlId(link.key, "url")}
        label="URL"
        type="url"
        inputMode="url"
        placeholder="https://"
        maxLength={HTTPS_URL_MAX_LENGTH}
        value={link.url}
        error={errors.url}
        hint={PROTECTED_PLATFORMS.has(link.platform) ? PUBLIC_NUMBER_NOTICE : undefined}
        onChange={(event) => onChange({ url: event.target.value })}
      />
      <Field
        id={controlId(link.key, "label")}
        label="Libellé (facultatif)"
        type="text"
        maxLength={LINK_LABEL_MAX_LENGTH}
        value={link.label}
        error={errors.label}
        onChange={(event) => onChange({ label: event.target.value })}
      />
      <div className="flex flex-wrap gap-2">
        <Button id={controlId(link.key, "up")} type="button" variant="outline" disabled={isFirst} onClick={() => onMove(-1)}>
          Monter<span className="sr-only"> le lien {position}</span>
        </Button>
        <Button id={controlId(link.key, "down")} type="button" variant="outline" disabled={isLast} onClick={() => onMove(1)}>
          Descendre<span className="sr-only"> le lien {position}</span>
        </Button>
        <Button type="button" variant="outline" onClick={onRemove}>
          Supprimer<span className="sr-only"> le lien {position}</span>
        </Button>
      </div>
    </fieldset>
  );
}
