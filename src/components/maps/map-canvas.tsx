"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MlMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapsContact } from "./types";

const ITURAMA: [number, number] = [-50.2009, -19.7276];
const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

function popupNode(contact: MapsContact): HTMLElement {
  const root = document.createElement("div");
  root.className = "space-y-1 text-sm";
  const title = document.createElement("strong"); title.textContent = contact.name; root.append(title);
  for (const value of [contact.phone, contact.address, contact.email, contact.stageName]) {
    if (!value) continue;
    const line = document.createElement("div"); line.textContent = value; root.append(line);
  }
  const actions = document.createElement("div"); actions.className = "flex gap-3 pt-1";
  const contactLink = document.createElement("a"); contactLink.href = contact.contactHref; contactLink.textContent = "Abrir contato";
  actions.append(contactLink);
  if (contact.conversationHref) { const chat = document.createElement("a"); chat.href = contact.conversationHref; chat.textContent = "Abrir conversa"; actions.append(chat); }
  root.append(actions); return root;
}

export default function MapCanvas({ contacts, heatmap, onSelect }: { contacts: MapsContact[]; heatmap: boolean; onSelect: (contact: MapsContact) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const contactsRef = useRef(contacts);
  const heatmapRef = useRef(heatmap);
  contactsRef.current = contacts;
  heatmapRef.current = heatmap;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: MAP_STYLE, center: ITURAMA, zoom: 11, attributionControl: false });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }));
    map.on("load", () => {
      map.addSource("crm-contacts", { type: "geojson", data: { type: "FeatureCollection", features: contactsRef.current.filter((c) => c.latitude != null && c.longitude != null).map((c) => ({ type: "Feature", geometry: { type: "Point", coordinates: [c.longitude!, c.latitude!] }, properties: { key: c.key, source: c.source } })) } });
      map.addLayer({ id: "crm-heat", type: "heatmap", source: "crm-contacts", layout: { visibility: heatmapRef.current ? "visible" : "none" }, paint: { "heatmap-weight": 1, "heatmap-intensity": 0.8, "heatmap-radius": 26, "heatmap-opacity": 0.65 } });
      map.addLayer({ id: "crm-pins", type: "circle", source: "crm-contacts", paint: { "circle-radius": 7, "circle-color": ["match", ["get", "source"], "baileys", "#22c55e", "#2563eb"], "circle-stroke-width": 2, "circle-stroke-color": "#ffffff" } });
      map.on("click", "crm-pins", (event) => {
        const key = event.features?.[0]?.properties?.key as string | undefined;
        const contact = contactsRef.current.find((item) => item.key === key); if (!contact) return;
        onSelect(contact);
        new maplibregl.Popup({ offset: 10 }).setLngLat([contact.longitude!, contact.latitude!]).setDOMContent(popupNode(contact)).addTo(map);
      });
      map.on("mouseenter", "crm-pins", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "crm-pins", () => { map.getCanvas().style.cursor = ""; });
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [onSelect]);

  useEffect(() => {
    const map = mapRef.current; if (!map?.isStyleLoaded()) return;
    const source = map.getSource("crm-contacts") as GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: contacts.filter((c) => c.latitude != null && c.longitude != null).map((c) => ({ type: "Feature", geometry: { type: "Point", coordinates: [c.longitude!, c.latitude!] }, properties: { key: c.key, source: c.source } })) });
    if (map.getLayer("crm-heat")) map.setLayoutProperty("crm-heat", "visibility", heatmap ? "visible" : "none");
  }, [contacts, heatmap]);

  return <div ref={containerRef} aria-label="Mapa de clientes" className="h-[520px] min-h-[360px] w-full overflow-hidden rounded-lg border border-border-strong" />;
}
