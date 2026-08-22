import { Anchor, Group, Text } from "@mantine/core";
import { SectionShell } from "./shared";
import type { SectionProps } from "../types";
import { t } from "../../../i18n/i18n";

interface Url {
  path: string;
  desc?: string;
  type?: string;
  private?: boolean;
}

/** UrlBase.urls (Person, Place, Repository) -- an actual external link,
 * unlike every other section here; opens in a new tab rather than going
 * through onNavigate (there's no Gramps object on the other end). */
export function UrlsSection({ detail }: SectionProps) {
  const urls = (detail.urls as Url[] | undefined) ?? [];
  if (urls.length === 0) return null;
  return (
    <SectionShell label={t("Web links")}>
      {urls.map((url, i) => (
        <Group key={i} gap={6}>
          <Anchor href={url.path} target="_blank" rel="noopener noreferrer" size="md">
            {url.desc || url.path}
          </Anchor>
          {url.private && <Text component="span" size="sm">🔒</Text>}
        </Group>
      ))}
    </SectionShell>
  );
}
