export type MapsContact = {
  key: string;
  source: "api" | "baileys";
  sourceId: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  locationStatus: "pending" | "located" | "failed" | null;
  manualLocation: boolean;
  createdAt: string | null;
  lastInteractionAt: string | null;
  stageId: string | null;
  stageName: string | null;
  amountCents: number | null;
  lastPurchaseAt: string | null;
  lastPurchaseAmount: number | null;
  consent: "opt_in" | "opt_out" | null;
  contactHref: string;
  conversationHref: string | null;
};

export type MapsPayload = {
  contacts: MapsContact[];
  stages: { id: string; name: string; kind: string }[];
  stats: {
    total: number;
    located: number;
    withAddress: number;
    api: number;
    baileys: number;
    byStage: Record<string, number>;
    byNeighborhood: Record<string, number>;
  };
};

export type MapsFilters = {
  q: string;
  source: "" | "api" | "baileys";
  stageId: string;
  city: string;
  neighborhood: string;
  address: "" | "with" | "without";
  email: "" | "with" | "without";
};

export const EMPTY_MAP_FILTERS: MapsFilters = {
  q: "", source: "", stageId: "", city: "", neighborhood: "", address: "", email: "",
};
