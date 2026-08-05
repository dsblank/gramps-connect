// Maps RELATED_CONFIG's section names to the component that renders them --
// RelatedPanel just looks each one up and renders it in order, so adding a
// type's config entry and a section component here is the whole story for
// a new section.
import type { ComponentType } from "react";
import type { RelatedSection } from "../config";
import type { SectionProps } from "../types";
import { ParentsSection } from "./ParentsSection";
import { FamiliesSection } from "./FamiliesSection";
import { ChildrenSection } from "./ChildrenSection";
import { AssociationsSection } from "./AssociationsSection";
import { EventsSection } from "./EventsSection";
import { ParticipantsSection } from "./ParticipantsSection";
import { PlaceSection } from "./PlaceSection";
import { ParentPlacesSection } from "./ParentPlacesSection";
import { SourceSection } from "./SourceSection";
import { RepositoriesSection } from "./RepositoriesSection";
import { CitationsSection } from "./CitationsSection";
import { NotesSection } from "./NotesSection";
import { MediaSection } from "./MediaSection";
import { AttributesSection } from "./AttributesSection";
import { AddressesSection } from "./AddressesSection";
import { UrlsSection } from "./UrlsSection";
import { TagsSection } from "./TagsSection";
import { BacklinksSection } from "./BacklinksSection";

export const SECTION_COMPONENTS: Record<RelatedSection, ComponentType<SectionProps>> = {
  parents: ParentsSection,
  families: FamiliesSection,
  children: ChildrenSection,
  associations: AssociationsSection,
  events: EventsSection,
  participants: ParticipantsSection,
  place: PlaceSection,
  parentPlaces: ParentPlacesSection,
  source: SourceSection,
  repositories: RepositoriesSection,
  citations: CitationsSection,
  notes: NotesSection,
  media: MediaSection,
  attributes: AttributesSection,
  addresses: AddressesSection,
  urls: UrlsSection,
  tags: TagsSection,
  backlinks: BacklinksSection,
};
