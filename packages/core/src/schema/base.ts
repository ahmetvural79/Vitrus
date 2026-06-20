// src/schema/base.ts
// vitrus-base — donmuş NodeType/EdgeType union'ının şema-paketi karşılığı (M3.7).
// Doğruluk kaynağı hâlâ types.ts'teki NODE_TYPES/EDGE_TYPES; bu pack onlara insan-okunur açıklama +
// kenar yön (from→to) kısıtı ekler. validatePack base'in TS union'ını TAM kapsadığını doğrular.
// from/to TAXONOMY.md'den; "*" = herhangi düğüm tipi.
import type { SchemaPack } from "./types.js";

export const VITRUS_BASE_PACK: SchemaPack = {
  name: "vitrus-base",
  version: "1.0.0",
  description: "Vitrus kurumsal-beyin taksonomisi: kişi/ekip/servis/karar/olay/politika + tipli kenarlar.",
  nodeTypes: [
    { name: "person", description: "Bir insan (çalışan, iş arkadaşı, paydaş). 'Kime sor' kişisi.", tierHint: "durable", slugPattern: "durable/people/<ad>" },
    { name: "team", description: "Org ekibi/grubu.", tierHint: "durable", slugPattern: "durable/teams/<ad>" },
    { name: "service", description: "Bir yazılım servisi/sistemi (sahiplenilen veya bağımlı olunan).", tierHint: "durable", slugPattern: "durable/services/<ad>" },
    { name: "decision", description: "Kayıtlı karar (ADR benzeri) — işlerin neden böyle olduğunu belirler.", tierHint: "durable", slugPattern: "durable/decisions/<id>-<konu>" },
    { name: "incident", description: "Olay/kesinti — geçmişten öğrenilecek.", tierHint: "durable", slugPattern: "durable/incidents/<tarih>-<konu>" },
    { name: "policy", description: "Uyulması gereken kural/politika.", tierHint: "durable", slugPattern: "durable/policies/<ad>" },
    { name: "company", description: "Şirket/kurum varlığı.", tierHint: "durable", slugPattern: "durable/companies/<ad>" },
    { name: "concept", description: "Kavram/konu (alan bilgisi).", tierHint: "durable", slugPattern: "durable/concepts/<ad>" },
    { name: "source", description: "Connector kaynağı/provenance düğümü (hangi belge/kaynak getirdi).", tierHint: "derived" },
    { name: "note", description: "Genel not — varsayılan tip (sınıflandırılmamış yakalama).", tierHint: "working" },
    { name: "meeting", description: "Toplantı (katılımcılar + kararlar).", tierHint: "working", slugPattern: "working/meetings/<tarih>-<konu>" },
    { name: "document", description: "Belge/sayfa (PR, commit, dosya, wiki).", tierHint: "working" },
    { name: "session", description: "Ajan oturum transcript'i (varsayılan özel ACL — ajan akıl yürütmesini yakalar).", tierHint: "working" },
    { name: "api_endpoint", description: "Agent-native API kartı (Gorilla deseni: retrievable + verify edilebilir endpoint — args/örnek/auth/kısıt).", tierHint: "durable", slugPattern: "durable/apis/<api>/<operationId>" },
  ],
  edgeTypes: [
    { name: "works_at", from: ["person"], to: ["company"], description: "Kişi şirkette çalışır.", inferredVerbs: ["çalış", "görevli", "works at"] },
    { name: "member_of", from: ["person"], to: ["team"], description: "Kişi ekibin üyesi.", inferredVerbs: ["üye", "member of"] },
    { name: "reports_to", from: ["person"], to: ["person"], description: "Org hiyerarşisi: kişi → yöneticisi.", inferredVerbs: ["rapor verir", "yöneticisi", "reports to"] },
    { name: "owns", from: ["team", "person"], to: ["service"], description: "Ekip/kişi servisin sahibi/sorumlusu.", inferredVerbs: ["sahip", "sorumlu", "owns"] },
    { name: "depends_on", from: ["service"], to: ["service"], description: "Servis başka servise bağımlı.", inferredVerbs: ["bağımlı", "ihtiyaç duyar", "depends on"] },
    { name: "attended", from: ["person"], to: ["meeting"], description: "Kişi toplantıya katıldı.", inferredVerbs: ["katıl", "toplantı", "attend"] },
    { name: "mentions", from: ["*"], to: ["*"], description: "Genel atıf (varsayılan, tip belirsizse).", inferredVerbs: ["bahset", "mentions"] },
    { name: "extends", from: ["*"], to: ["*"], description: "Bir düğüm diğerini genişletir/dayanır.", inferredVerbs: ["genişlet", "dayanı", "extends"] },
    { name: "contradicts", from: ["*"], to: ["*"], description: "İki düğüm çelişir (deterministik çelişki tespiti).", inferredVerbs: ["çeliş", "çakış", "contradicts"] },
    { name: "supersedes", from: ["decision", "policy", "service", "document"], to: ["decision", "policy", "service", "document"], description: "Yeni sürüm öncekini geçersiz kılar (bayatlık sinyali) — karar/politika/servis/belge.", inferredVerbs: ["geçersiz", "yerini al", "supersedes"] },
    { name: "decided_by", from: ["decision", "incident", "policy"], to: ["person"], description: "Karar/şey kişi tarafından verildi.", inferredVerbs: ["karar verildi", "kararıyla", "decided by"] },
    { name: "caused_by", from: ["incident"], to: ["decision", "incident", "service", "policy"], description: "Olayın nedeni.", inferredVerbs: ["nedeniyle", "yol açtı", "caused by"] },
    { name: "resolved_by", from: ["incident"], to: ["person"], description: "Olayı çözen kişi.", inferredVerbs: ["çözüldü", "gideren", "resolved by"] },
    { name: "advises", from: ["person"], to: ["team", "company"], description: "Kişi ekibe/şirkete danışmanlık yapar.", inferredVerbs: ["danış", "advis"] },
    { name: "founded", from: ["person"], to: ["company"], description: "Kişi şirketi kurdu.", inferredVerbs: ["kurdu", "kurucu", "founded"] },
  ],
};
