import React, { useEffect, useState, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import kinanaLogo from "@/assets/kinana-logo.png";
import {
  Lock,
  Unlock,
  KeyRound,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Settings,
  Plus,
  Trash2,
  Pencil,
  Copy,
  CopyPlus,
  Check,
  Dices,
  Eye,
  EyeOff,
  Image as ImageIcon,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  X,
  ExternalLink,
  RefreshCw,
  Key,
  LayoutGrid,
  List,
  Download,
  Upload,
  FolderSync,
  FolderOpen,
  Sparkles,
  Search,
  CreditCard,
  User,
  ArrowDownAZ,
  GripVertical,
  Clock,
  CheckSquare,
  Square,
  CheckCheck,
  Pin,
  PinOff,
} from "lucide-react";
import {
  POPULAR_SERVICES,
  generateCinematicCoverSvg,
  getServiceCoverAsync,
  loadServiceCovers,
} from "@/data/popularServices";

interface AccountSummary {
  id: string;
  label: string;
  username: string;
  has_password: boolean;
  has_notes: boolean;
  url?: string;
}

interface AccountDetail {
  id: string;
  label: string;
  username: string;
  email: string;
  recovery_key: string;
  notes: string;
  url: string;
  has_password: boolean;
  password?: string;
}

interface ServiceSummary {
  id: string;
  name: string;
  icon_data?: string;
  accounts: AccountSummary[];
}

interface VaultSummary {
  services: ServiceSummary[];
  total_services: number;
  total_accounts: number;
  updated_at: number;
}

// Category labels for popular presets
const PRESET_CATEGORY_LABELS: Record<string, string> = {
  gaming: "ألعاب",
  social: "تواصل",
  entertainment: "ترفيه",
  tech: "تقنية",
  work: "تسوق وعمل",
  finance: "بنوك وبطاقات",
};

// Detect card brand/network from number or service name
function detectCardBrand(num: string = "", serviceName: string = ""): { name: string; color: string; badge: string } {
  const clean = num.replace(/\D/g, "");
  if (clean.startsWith("4") || serviceName.toLowerCase().includes("visa")) {
    return { name: "Visa", color: "#1A1F71", badge: "VISA" };
  }
  if (/^(5[1-5]|2[2-7])/.test(clean) || serviceName.toLowerCase().includes("mastercard")) {
    return { name: "Mastercard", color: "#EB001B", badge: "Mastercard" };
  }
  if (/^(588845|588846|588847|588848|588849|588850|588851|588852|588853|588854|588855|588856|588857|588858|588859|484783|9682)/.test(clean) || serviceName.includes("مدى") || serviceName.toLowerCase().includes("mada")) {
    return { name: "Mada", color: "#004A80", badge: "مدى mada" };
  }
  if (serviceName.includes("الراجحي") || serviceName.toLowerCase().includes("rajhi")) {
    return { name: "Al Rajhi Bank", color: "#0C2340", badge: "مصرف الراجحي" };
  }
  if (serviceName.includes("الأهلي") || serviceName.toLowerCase().includes("snb")) {
    return { name: "SNB", color: "#006837", badge: "الأهلي SNB" };
  }
  if (serviceName.includes("الإنماء") || serviceName.toLowerCase().includes("alinma")) {
    return { name: "Alinma Bank", color: "#8C6239", badge: "مصرف الإنماء" };
  }
  if (serviceName.toLowerCase().includes("stc pay") || serviceName.includes("إس تي سي باي")) {
    return { name: "stc pay", color: "#4F008C", badge: "stc pay" };
  }
  if (serviceName.toLowerCase().includes("urpay") || serviceName.includes("يورباي")) {
    return { name: "Urpay", color: "#0F172A", badge: "urpay" };
  }
  return { name: "Card", color: "#1E293B", badge: "BANK CARD" };
}

// Check if a service is inherently a bank or card service
function isBankOrCardService(serviceName: string = ""): boolean {
  return Boolean(
    serviceName.match(/(بطاقة|فيزا|ماستركارد|مدى|Visa|Mastercard|Mada|Al Rajhi|SNB|Alinma|urpay|stc pay|بنك|مصرف|الراجحي|الأهلي|الإنماء)/i)
  );
}

// Check if an account is a dedicated bank card account
function isAccountCard(acc: { notes?: string; url?: string }, serviceName: string = ""): boolean {
  if (acc.notes?.includes("[CARD]")) return true;
  if (acc.url && /^\d{2}\/\d{2}$/.test(acc.url.trim())) return true;
  if (isBankOrCardService(serviceName)) return true;
  return false;
}


// Color palette for services without custom icons
const COLOR_PALETTE = [
  "from-indigo-600 to-indigo-800",
  "from-rose-600 to-rose-800",
  "from-amber-600 to-amber-800",
  "from-emerald-600 to-emerald-800",
  "from-cyan-600 to-cyan-800",
  "from-violet-600 to-violet-800",
  "from-fuchsia-600 to-fuchsia-800",
  "from-blue-600 to-blue-800",
];

function getServiceGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

// Automatic high-quality client-side image compression & resizing
function processImageUpload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject("يرجى اختيار ملف صورة صالح (PNG, JPG, WebP)");
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject("فشل قراءة ملف الصورة");
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject("فشل معالجة أبعاد الصورة");
      img.onload = () => {
        const MAX_WIDTH = 1280;
        const MAX_HEIGHT = 720;
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH || height > MAX_HEIGHT) {
          if (width / height > MAX_WIDTH / MAX_HEIGHT) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          } else {
            width = Math.round((width * MAX_HEIGHT) / height);
            height = MAX_HEIGHT;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject("فشل معالجة الصورة في المتصفح");
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);

        let dataUrl = canvas.toDataURL("image/webp", 0.85);
        if (!dataUrl.startsWith("data:image/webp")) {
          dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        }

        resolve(dataUrl);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function normalizeArabicSearch(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "") // remove Tashkeel / diacritics
    .replace(/[أإآٱ]/g, "ا") // unify Alef variants
    .replace(/ة/g, "ه") // unify Ta Marbuta / Ha
    .replace(/[ىئ]/g, "ي") // unify Ya / Alef Maksura
    .replace(/[\s\-_.]+/g, " ") // normalize whitespace & separators
    .trim();
}

export default function App() {
  const [exists, setExists] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState<boolean>(false);
  const [password, setPassword] = useState<string>("");
  const [summary, setSummary] = useState<VaultSummary | null>(null);
  const summaryRef = useRef<VaultSummary | null>(summary);
  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Fullscreen state (immersive gaming/media mode)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showFullscreenPill, setShowFullscreenPill] = useState<boolean>(false);
  const fullscreenPillTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-unlock status & Settings
  const [autoUnlockActive, setAutoUnlockActive] = useState<boolean>(true);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [savedPasswordHint, setSavedPasswordHint] = useState<string | null>(null);
  const [showSavedPassword, setShowSavedPassword] = useState<boolean>(false);
  const [showAutoUnlockModal, setShowAutoUnlockModal] = useState<boolean>(false);
  const [autoUnlockPassword, setAutoUnlockPassword] = useState<string>("");
  const [showAutoUnlockPassword, setShowAutoUnlockPassword] = useState<boolean>(false);
  const [autoUnlockModalError, setAutoUnlockModalError] = useState<string | null>(null);
  const [autoUnlockModalLoading, setAutoUnlockModalLoading] = useState<boolean>(false);
  const [settingsFeedback, setSettingsFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Auto-lock inactivity timeout settings (null = never, number = seconds)
  const [autoLockTimeout, setAutoLockTimeout] = useState<number | null>(() => {
    try {
      const saved = localStorage.getItem("kinana_auto_lock_timeout");
      if (saved === "never") return null;
      if (saved !== null) {
        const val = parseInt(saved, 10);
        return isNaN(val) ? 300 : val;
      }
      return 300;
    } catch {
      return 300;
    }
  });
  const [customTimeoutMinutes, setCustomTimeoutMinutes] = useState<string>("");

  // Pinned Services state (stored in localStorage)
  const [pinnedServiceIds, setPinnedServiceIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("kinana_pinned_services");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const togglePinService = (serviceId: string) => {
    setPinnedServiceIds((prev) => {
      const next = prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId];
      try {
        localStorage.setItem("kinana_pinned_services", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Selection mode & Batch actions state
  const [selectionMode, setSelectionMode] = useState<boolean>(false);
  const selectionModeRef = useRef<boolean>(selectionMode);
  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const selectedServiceIdsRef = useRef<string[]>(selectedServiceIds);
  useEffect(() => {
    selectedServiceIdsRef.current = selectedServiceIds;
  }, [selectedServiceIds]);

  const [showBatchDeleteModal, setShowBatchDeleteModal] = useState<boolean>(false);

  // Windows-style Marquee Box Selection state (Drag in empty space to select cards)
  const [marqueeBox, setMarqueeBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const isMarqueeSelectingRef = useRef<boolean>(false);

  // Alphabetical sort toggle state
  const [isAlphabeticallySorted, setIsAlphabeticallySorted] = useState<boolean>(false);
  const preSortOrderRef = useRef<string[] | null>(null);

  // Card Pointer Drag-and-Drop state & refs (100% immune to OS OLE drag forbidden cursor)
  const [draggedServiceId, setDraggedServiceId] = useState<string | null>(null);
  const draggedServiceIdRef = useRef<string | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const lastSwappedTargetRef = useRef<string | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const pendingServiceIdRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const didLongPressRef = useRef<boolean>(false);
  const isSweepSelectingRef = useRef<boolean>(false);

  // Field Reveal / Mask Toggles for Forms
  const [showUnlockPassword, setShowUnlockPassword] = useState<boolean>(false);
  const [showCreatePassword, setShowCreatePassword] = useState<boolean>(false);
  const [showAccPassword, setShowAccPassword] = useState<boolean>(false);
  const [showAccRecoveryKey, setShowAccRecoveryKey] = useState<boolean>(false);
  const [showEditPassword, setShowEditPassword] = useState<boolean>(false);
  const [showEditRecoveryKey, setShowEditRecoveryKey] = useState<boolean>(false);

  // Change Password state
  const [newMasterPassword, setNewMasterPassword] = useState<string>("");
  const [confirmMasterPassword, setConfirmMasterPassword] = useState<string>("");
  const [passwordChangeSuccess, setPasswordChangeSuccess] = useState<string | null>(null);

  // Emergency Recovery Key state
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [copiedRecoveryKey, setCopiedRecoveryKey] = useState<boolean>(false);
  const [showRecoveryModal, setShowRecoveryModal] = useState<boolean>(false);
  const [inputRecoveryKey, setInputRecoveryKey] = useState<string>("");

  // Zoom level state & HUD indicator
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const zoomLevelRef = useRef<number>(zoomLevel);
  useEffect(() => {
    zoomLevelRef.current = zoomLevel;
  }, [zoomLevel]);
  const [zoomHud, setZoomHud] = useState<{ text: string; visible: boolean }>({
    text: "100%",
    visible: false,
  });
  const zoomHudTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Backup Export & Import State
  const [exportImportStatus, setExportImportStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isProcessingBackup, setIsProcessingBackup] = useState<boolean>(false);

  // Selected service for detail view
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [serviceAccounts, setServiceAccounts] = useState<AccountDetail[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState<boolean>(false);

  // Delete Confirmation Modals State (Replaces native browser confirm)
  const [serviceToDelete, setServiceToDelete] = useState<ServiceSummary | null>(null);
  const [accountToDelete, setAccountToDelete] = useState<{
    serviceId: string;
    accountId: string;
    label: string;
  } | null>(null);

  // View mode: 'netflix' (widescreen edge-to-edge cover cards) vs 'list' (compact list with small images & count)
  const [viewMode, setViewMode] = useState<"netflix" | "list">(() => {
    try {
      return (localStorage.getItem("kinana_view_mode") as "netflix" | "list") || "netflix";
    } catch {
      return "netflix";
    }
  });

  const toggleViewMode = (mode: "netflix" | "list") => {
    setViewMode(mode);
    try {
      localStorage.setItem("kinana_view_mode", mode);
    } catch {}
  };

  // Netflix card titles visibility toggle (persisted)
  const [showCardTitles, setShowCardTitles] = useState<boolean>(() => {
    try {
      return localStorage.getItem("kinana_show_titles") === "true";
    } catch {
      return false;
    }
  });

  const toggleShowCardTitles = () => {
    setShowCardTitles((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("kinana_show_titles", String(next));
      } catch {}
      return next;
    });
  };

  // Modals visibility
  const [showAddService, setShowAddService] = useState<boolean>(false);
  const [showEditService, setShowEditService] = useState<boolean>(false);
  const [showAddAccount, setShowAddAccount] = useState<boolean>(false);
  const [editingAccount, setEditingAccount] = useState<AccountDetail | null>(null);

  // Modal-specific error alerts (displayed inside modals)
  const [addServiceError, setAddServiceError] = useState<string | null>(null);
  const [editServiceError, setEditServiceError] = useState<string | null>(null);
  const [addAccountError, setAddAccountError] = useState<string | null>(null);
  const [editAccountError, setEditAccountError] = useState<string | null>(null);

  // New Service Form State
  const [newServiceName, setNewServiceName] = useState<string>("");
  const [newServiceIcon, setNewServiceIcon] = useState<string | null>(null);

  // Edit Service Form State
  const [editServiceName, setEditServiceName] = useState<string>("");
  const [editServiceIcon, setEditServiceIcon] = useState<string | null>(null);

  // Presets Search & Category Filter State
  const [presetSearch, setPresetSearch] = useState<string>("");
  const [presetCategory, setPresetCategory] = useState<string>("all");
  const [presetViewMode, setPresetViewMode] = useState<"grid" | "list">("grid");

  // Lazy-load studio covers in background only when Add/Edit service dialog opens
  useEffect(() => {
    if (showAddService || showEditService) {
      loadServiceCovers();
    }
  }, [showAddService, showEditService]);

  const filteredPresets = useMemo(() => {
    const rawQ = presetSearch.trim();
    let list = POPULAR_SERVICES.slice();

    if (rawQ || presetCategory !== "all") {
      const normQ = normalizeArabicSearch(rawQ);
      const compactQ = normQ.replace(/\s+/g, "");

      list = list.filter((preset) => {
        const matchesCat = presetCategory === "all" || preset.category === presetCategory;
        if (!matchesCat) return false;
        if (!normQ) return true;

        const normName = normalizeArabicSearch(preset.name);
        const compactName = normName.replace(/\s+/g, "");
        const normAr = normalizeArabicSearch(preset.arabicName);
        const compactAr = normAr.replace(/\s+/g, "");

        return (
          normName.includes(normQ) ||
          compactName.includes(compactQ) ||
          normAr.includes(normQ) ||
          compactAr.includes(compactQ) ||
          preset.id.toLowerCase().includes(normQ) ||
          preset.defaultUrl.toLowerCase().includes(normQ)
        );
      });
    }

    // Always sort presets alphabetically (A-Z)
    return list.sort((a, b) =>
      a.name.localeCompare(b.name, "ar", { sensitivity: "base" })
    );
  }, [presetCategory, presetSearch]);

  // New Account Form State (Multi-Field)
  const [accLabel, setAccLabel] = useState<string>("");
  const [accUsername, setAccUsername] = useState<string>("");
  const [accEmail, setAccEmail] = useState<string>("");
  const [accPassword, setAccPassword] = useState<string>("");
  const [accRecoveryKey, setAccRecoveryKey] = useState<string>("");
  const [accUrl, setAccUrl] = useState<string>("");
  const [accNotes, setAccNotes] = useState<string>("");

  // Edit Account Form State (Multi-Field)
  const [editLabel, setEditLabel] = useState<string>("");
  const [editUsername, setEditUsername] = useState<string>("");
  const [editEmail, setEditEmail] = useState<string>("");
  const [editPassword, setEditPassword] = useState<string>("");
  const [editRecoveryKey, setEditRecoveryKey] = useState<string>("");
  const [editUrl, setEditUrl] = useState<string>("");
  const [editNotes, setEditNotes] = useState<string>("");

  // Dedicated Bank Card Form State & Reveal Toggles
  const [accountFormMode, setAccountFormMode] = useState<"login" | "card">("login");
  const [cardHolder, setCardHolder] = useState<string>("");
  const [cardNumber, setCardNumber] = useState<string>("");
  const [cardExpiry, setCardExpiry] = useState<string>("");
  const [cardCvv, setCardCvv] = useState<string>("");
  const [cardPin, setCardPin] = useState<string>("");
  const [showCardNumber, setShowCardNumber] = useState<boolean>(false);
  const [showCardCvv, setShowCardCvv] = useState<boolean>(false);
  const [revealedCardNumbers, setRevealedCardNumbers] = useState<Record<string, boolean>>({});
  const [revealedCardCvvs, setRevealedCardCvvs] = useState<Record<string, boolean>>({});
  const [revealedCardPins, setRevealedCardPins] = useState<Record<string, boolean>>({});
  const [revealedAccountPasswords, setRevealedAccountPasswords] = useState<Record<string, boolean>>({});
  const [revealedAccountRecoveryKeys, setRevealedAccountRecoveryKeys] = useState<Record<string, boolean>>({});

  const toggleRevealAccountPassword = async (serviceId: string, account: AccountDetail) => {
    const accId = account.id;
    if (revealedAccountPasswords[accId]) {
      setRevealedAccountPasswords((prev) => ({ ...prev, [accId]: false }));
    } else {
      if (!account.password) {
        try {
          const pwd = await invoke<string>("get_account_password", {
            serviceId,
            accountId: accId,
          });
          setServiceAccounts((prev) =>
            prev.map((a) => (a.id === accId ? { ...a, password: pwd } : a))
          );
        } catch (err) {
          console.error("Failed to fetch account password:", err);
        }
      }
      setRevealedAccountPasswords((prev) => ({ ...prev, [accId]: true }));
    }
  };

  const toggleRevealAccountRecoveryKey = (accountId: string) => {
    setRevealedAccountRecoveryKeys((prev) => ({
      ...prev,
      [accountId]: !prev[accountId],
    }));
  };

  // Copy feedback state: key = `${accountId}_${field}`
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const selectedService = summary?.services.find((s) => s.id === selectedServiceId) || null;

  // Displayed services with pinned services always at the top
  const displayedServices = useMemo(() => {
    if (!summary?.services) return [];
    if (pinnedServiceIds.length === 0) return summary.services;
    const pinnedSet = new Set(pinnedServiceIds);
    const pinned = summary.services.filter((s) => pinnedSet.has(s.id));
    const unpinned = summary.services.filter((s) => !pinnedSet.has(s.id));
    return [...pinned, ...unpinned];
  }, [summary?.services, pinnedServiceIds]);

  // Zoom management helper with on-screen HUD toast
  const applyZoom = (newLevel: number) => {
    const clamped = Math.max(0.7, Math.min(2.0, parseFloat(newLevel.toFixed(2))));
    setZoomLevel(clamped);
    zoomLevelRef.current = clamped;
    const pct = `${Math.round(clamped * 100)}%`;
    setZoomHud({ text: pct, visible: true });

    if (zoomHudTimerRef.current) {
      clearTimeout(zoomHudTimerRef.current);
    }
    zoomHudTimerRef.current = setTimeout(() => {
      setZoomHud((prev) => ({ ...prev, visible: false }));
    }, 1000);
  };

  const fetchSummary = async () => {
    try {
      const data = await invoke<VaultSummary>("get_vault_summary");
      setSummary(data);
      setUnlocked(true);
      setError(null);
    } catch (err: any) {
      setError(err?.toString() || "فشل جلب بيانات الخزنة");
    }
  };

  // Fetch accounts when service detail modal is open
  const fetchServiceAccounts = async (serviceId: string) => {
    try {
      setLoadingAccounts(true);
      const accs = await invoke<AccountDetail[]>("get_service_accounts", { serviceId });
      setServiceAccounts(accs);
    } catch (err: any) {
      setError(err?.toString() || "فشل جلب تفاصيل الحسابات");
    } finally {
      setLoadingAccounts(false);
    }
  };

  useEffect(() => {
    if (selectedServiceId) {
      fetchServiceAccounts(selectedServiceId);
    } else {
      setServiceAccounts([]);
    }
  }, [selectedServiceId]);

  // Initial startup logic: Check vault existence, sync auto-lock timeout, and attempt auto-unlock
  const initApp = async () => {
    try {
      setLoading(true);
      setError(null);

      const isExist = await invoke<boolean>("vault_exists");
      setExists(isExist);

      const isAutoEnabled = await invoke<boolean>("is_auto_unlock_enabled");
      setAutoUnlockActive(isAutoEnabled);

      // Sync saved auto-lock timeout with backend
      try {
        await invoke("set_auto_lock_timeout", { seconds: autoLockTimeout });
      } catch (err) {
        console.warn("Failed to sync auto-lock timeout:", err);
      }

      if (isExist && isAutoEnabled) {
        const unlockedViaStore = await invoke<boolean>("auto_unlock_vault");
        if (unlockedViaStore) {
          await fetchSummary();
          return;
        }
      }
    } catch (err: any) {
      console.warn("Auto-unlock not available or failed:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    initApp();

    // Listen to auto-lock event from backend
    const unlistenPromise = listen("vault-auto-locked", () => {
      setUnlocked(false);
      setSummary(null);
      setSelectedServiceId(null);
      setPassword("");
      invoke("trim_app_memory").catch(() => {});
      setShowAddService(false);
      setShowEditService(false);
      setShowAddAccount(false);
      setEditingAccount(null);
      setShowSettings(false);
      setShowRecoveryModal(false);
      setServiceToDelete(null);
      setAccountToDelete(null);
      setError("تم إقفال كنانة تلقائياً بسبب الخمول لحماية بياناتك.");
    });

    const syncFullscreen = async () => {
      try {
        const full = await invoke<boolean>("is_fullscreen");
        setIsFullscreen(full);
      } catch {}
    };

    syncFullscreen();
    window.addEventListener("resize", syncFullscreen);

    // Keyboard shortcuts: F11 fullscreen, Ctrl+= zoom in, Ctrl+- zoom out, Ctrl+0 zoom reset
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === "F11") {
        e.preventDefault();
        try {
          const isFull = await invoke<boolean>("toggle_fullscreen");
          setIsFullscreen(isFull);
        } catch (err) {
          console.warn("Fullscreen toggle failed:", err);
        }
      } else if (e.key === "Escape") {
        if (selectionModeRef.current) {
          e.preventDefault();
          setSelectionMode(false);
          setSelectedServiceIds([]);
          return;
        }
        try {
          const isFull = await invoke<boolean>("is_fullscreen");
          if (isFull) {
            e.preventDefault();
            const next = await invoke<boolean>("toggle_fullscreen");
            setIsFullscreen(next);
          }
        } catch {}
      } else if (e.ctrlKey && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        applyZoom(zoomLevelRef.current + 0.1);
      } else if (e.ctrlKey && e.key === "-") {
        e.preventDefault();
        applyZoom(zoomLevelRef.current - 0.1);
      } else if (e.ctrlKey && e.key === "0") {
        e.preventDefault();
        applyZoom(1.0);
      }
    };

    // Mouse wheel zoom: Ctrl + Wheel Up (zoom in), Ctrl + Wheel Down (zoom out)
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          applyZoom(zoomLevelRef.current + 0.1);
        } else if (e.deltaY > 0) {
          applyZoom(zoomLevelRef.current - 0.1);
        }
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("contextmenu", handleContextMenu);

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("resize", syncFullscreen);
      if (zoomHudTimerRef.current) clearTimeout(zoomHudTimerRef.current);
    };
  }, []);

  // Fullscreen pill auto-hide after 4.5s upon entering fullscreen
  useEffect(() => {
    if (isFullscreen) {
      setShowFullscreenPill(true);
      if (fullscreenPillTimerRef.current) clearTimeout(fullscreenPillTimerRef.current);
      fullscreenPillTimerRef.current = setTimeout(() => {
        setShowFullscreenPill(false);
      }, 4500);
    } else {
      setShowFullscreenPill(false);
      if (fullscreenPillTimerRef.current) clearTimeout(fullscreenPillTimerRef.current);
    }
  }, [isFullscreen]);

  // When in fullscreen: reveal pill when cursor touches the top edge (clientY <= 35)
  useEffect(() => {
    if (!isFullscreen) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (e.clientY <= 35) {
        setShowFullscreenPill(true);
        if (fullscreenPillTimerRef.current) clearTimeout(fullscreenPillTimerRef.current);
      } else if (e.clientY > 80 && showFullscreenPill) {
        if (fullscreenPillTimerRef.current) clearTimeout(fullscreenPillTimerRef.current);
        fullscreenPillTimerRef.current = setTimeout(() => {
          setShowFullscreenPill(false);
        }, 1500);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, [isFullscreen, showFullscreenPill]);

  const handleToggleFullscreen = async () => {
    try {
      const isFull = await invoke<boolean>("toggle_fullscreen");
      setIsFullscreen(isFull);
    } catch (err) {
      console.warn("Fullscreen toggle failed:", err);
    }
  };

  // Global user activity pinger (throttled to every 15s) so active usage never triggers auto-lock
  useEffect(() => {
    if (!unlocked) return;

    let lastPing = Date.now();
    const handleUserActivity = () => {
      const now = Date.now();
      if (now - lastPing > 15000) {
        lastPing = now;
        invoke("ping_activity").catch(() => {});
      }
    };

    window.addEventListener("mousemove", handleUserActivity, { passive: true });
    window.addEventListener("keydown", handleUserActivity, { passive: true });
    window.addEventListener("mousedown", handleUserActivity, { passive: true });
    window.addEventListener("wheel", handleUserActivity, { passive: true });

    return () => {
      window.removeEventListener("mousemove", handleUserActivity);
      window.removeEventListener("keydown", handleUserActivity);
      window.removeEventListener("mousedown", handleUserActivity);
      window.removeEventListener("wheel", handleUserActivity);
    };
  }, [unlocked]);

  // Prevent auto-lock while any modal with user inputs is open so unsaved input is never lost
  const isAnyModalActive =
    showAddAccount ||
    Boolean(editingAccount) ||
    showAddService ||
    showEditService ||
    showSettings ||
    showRecoveryModal;

  useEffect(() => {
    if (!unlocked || !isAnyModalActive) return;

    invoke("ping_activity").catch(() => {});
    const interval = setInterval(() => {
      invoke("ping_activity").catch(() => {});
    }, 10000);

    return () => clearInterval(interval);
  }, [unlocked, isAnyModalActive]);

  const handleSetAutoLockTimeout = async (secs: number | null) => {
    setAutoLockTimeout(secs);
    try {
      if (secs === null) {
        localStorage.setItem("kinana_auto_lock_timeout", "never");
      } else {
        localStorage.setItem("kinana_auto_lock_timeout", secs.toString());
      }
      await invoke("set_auto_lock_timeout", { seconds: secs });
    } catch (e) {
      console.warn("Failed to set auto-lock timeout:", e);
    }
  };

  const enterSelectionModeWithService = (serviceId: string) => {
    setSelectionMode(true);
    setSelectedServiceIds((prev) => {
      if (prev.includes(serviceId)) return prev;
      return [...prev, serviceId];
    });
  };

  const toggleSelectService = (serviceId: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(serviceId) ? prev.filter((id) => id !== serviceId) : [...prev, serviceId]
    );
  };

  // Rock-solid Pointer-based Drag & Drop (Zero OS OLE forbidden icon, works 100% on Windows WebView2)
  const handlePointerDown = (e: React.PointerEvent, serviceId: string) => {
    if (e.button !== 0) return; // Only main left click

    const target = e.target as HTMLElement;
    // Don't drag if user clicked on action buttons, checkboxes, or links
    if (target.closest("button") || target.closest("input") || target.closest("a") || target.closest("[role='menuitem']")) {
      return;
    }

    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    pendingServiceIdRef.current = serviceId;
    didLongPressRef.current = false;
    isDraggingRef.current = false;

    // Long press timer (350ms) to trigger selection mode and enable sweep-select
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      isSweepSelectingRef.current = true;
      enterSelectionModeWithService(serviceId);
    }, 350);

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (!pointerStartRef.current || !pendingServiceIdRef.current) return;
      const dx = moveEvent.clientX - pointerStartRef.current.x;
      const dy = moveEvent.clientY - pointerStartRef.current.y;
      const dist = Math.hypot(dx, dy);

      // Case A: Long-press triggered -> Sweep-select mode (selects every card swept over)
      if (isSweepSelectingRef.current) {
        const elemUnder = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        const cardTarget = elemUnder?.closest("[data-service-id]");
        if (cardTarget) {
          const hoveredId = cardTarget.getAttribute("data-service-id");
          if (hoveredId) {
            setSelectedServiceIds((prev) => {
              if (prev.includes(hoveredId)) return prev;
              return [...prev, hoveredId];
            });
          }
        }
        return;
      }

      // Case B: Dragged before long-press (quick drag) -> Card reordering
      if (dist > 7) {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }

        // Do not reorder if currently in selection mode
        if (selectionMode) {
          const elemUnder = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
          const cardTarget = elemUnder?.closest("[data-service-id]");
          if (cardTarget) {
            const hoveredId = cardTarget.getAttribute("data-service-id");
            if (hoveredId) {
              setSelectedServiceIds((prev) => {
                if (prev.includes(hoveredId)) return prev;
                return [...prev, hoveredId];
              });
            }
          }
          return;
        }

        if (!isDraggingRef.current) {
          isDraggingRef.current = true;
          draggedServiceIdRef.current = pendingServiceIdRef.current;
          setDraggedServiceId(pendingServiceIdRef.current);
          lastSwappedTargetRef.current = pendingServiceIdRef.current;
          document.body.style.cursor = "grabbing";
          document.body.style.userSelect = "none";
        }

        const elemUnder = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        const cardTarget = elemUnder?.closest("[data-service-id]");
        if (cardTarget) {
          const targetId = cardTarget.getAttribute("data-service-id");
          const sourceId = draggedServiceIdRef.current;
          if (
            targetId &&
            sourceId &&
            targetId !== sourceId &&
            targetId !== lastSwappedTargetRef.current &&
            summaryRef.current
          ) {
            const currentServices = [...summaryRef.current.services];
            const fromIdx = currentServices.findIndex((s) => s.id === sourceId);
            const toIdx = currentServices.findIndex((s) => s.id === targetId);
            if (fromIdx !== -1 && toIdx !== -1) {
              lastSwappedTargetRef.current = targetId;
              const [moved] = currentServices.splice(fromIdx, 1);
              currentServices.splice(toIdx, 0, moved);
              setSummary({ ...summaryRef.current, services: currentServices });
              setIsAlphabeticallySorted(false);
            }
          }
        }
      }
    };

    const onPointerUp = async () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }

      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      const wasDragging = isDraggingRef.current;
      isSweepSelectingRef.current = false;
      pointerStartRef.current = null;
      pendingServiceIdRef.current = null;

      if (wasDragging) {
        draggedServiceIdRef.current = null;
        setDraggedServiceId(null);
        lastSwappedTargetRef.current = null;

        setTimeout(() => {
          isDraggingRef.current = false;
        }, 150);

        if (summaryRef.current) {
          try {
            const serviceIds = summaryRef.current.services.map((s) => s.id);
            const updated = await invoke<VaultSummary>("reorder_services", { serviceIds });
            setSummary(updated);
          } catch (err) {
            console.error("Failed to persist reordered services:", err);
          }
        }
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const handleCardClick = (serviceId: string) => {
    if (isDraggingRef.current || didLongPressRef.current || isMarqueeSelectingRef.current) return;
    if (selectionMode) {
      toggleSelectService(serviceId);
    } else {
      setSelectedServiceId(serviceId);
    }
  };

  // Windows-style Rubber-band / Marquee selection from empty space
  const handleBackgroundPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // Only main left click

    const target = e.target as HTMLElement;
    // Don't start marquee if user clicked on interactive elements, modals, cards, header, or menu
    if (
      target.closest("button") ||
      target.closest("input") ||
      target.closest("a") ||
      target.closest("[role='menuitem']") ||
      target.closest("[data-service-id]") ||
      target.closest("header") ||
      target.closest("[role='dialog']") ||
      target.closest(".fixed")
    ) {
      return;
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const initialSelected = [...selectedServiceIdsRef.current];
    let hasStartedMarquee = false;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const curX = moveEvent.clientX;
      const curY = moveEvent.clientY;
      const dx = curX - startX;
      const dy = curY - startY;
      const dist = Math.hypot(dx, dy);

      if (!hasStartedMarquee && dist > 5) {
        hasStartedMarquee = true;
        isMarqueeSelectingRef.current = true;
        document.body.style.userSelect = "none";
      }

      if (hasStartedMarquee) {
        const left = Math.min(startX, curX);
        const top = Math.min(startY, curY);
        const width = Math.max(startX, curX) - left;
        const height = Math.max(startY, curY) - top;

        setMarqueeBox({ left, top, width, height });

        // Query all service cards in DOM and test AABB intersection
        const allCards = document.querySelectorAll("[data-service-id]");
        const intersectedIds: string[] = [];

        allCards.forEach((cardElem) => {
          const rect = cardElem.getBoundingClientRect();
          const intersects = !(
            rect.right < left ||
            rect.left > left + width ||
            rect.bottom < top ||
            rect.top > top + height
          );
          if (intersects) {
            const sid = cardElem.getAttribute("data-service-id");
            if (sid) intersectedIds.push(sid);
          }
        });

        // Automatically activate selection mode when dragging over cards
        if (!selectionModeRef.current && (width > 10 || height > 10)) {
          setSelectionMode(true);
        }

        // Union with initialSelected (if Shift/Ctrl is held) or keep selection reactive to marquee
        const combined = Array.from(new Set([...initialSelected, ...intersectedIds]));
        setSelectedServiceIds(combined);
      }
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      document.body.style.userSelect = "";

      if (hasStartedMarquee) {
        setMarqueeBox(null);
        setTimeout(() => {
          isMarqueeSelectingRef.current = false;
        }, 50);
      } else {
        // Plain click in empty space without dragging:
        // In Windows Explorer, clicking empty space deselects everything!
        if (selectionModeRef.current) {
          setSelectionMode(false);
          setSelectedServiceIds([]);
        }
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  const handleDuplicateService = async (serviceId: string) => {
    try {
      setError(null);
      const updated = await invoke<VaultSummary>("duplicate_service", { serviceId });
      setSummary(updated);
      setIsAlphabeticallySorted(false);
    } catch (err: any) {
      setError(err?.toString() || "فشل تكرار الخدمة");
    }
  };

  const handleToggleSortAlphabetically = async () => {
    if (!summary || summary.services.length <= 1) return;

    if (!isAlphabeticallySorted) {
      preSortOrderRef.current = summary.services.map((s) => s.id);
      const sorted = [...summary.services].sort((a, b) =>
        a.name.localeCompare(b.name, "ar", { sensitivity: "base" })
      );
      setSummary({ ...summary, services: sorted });
      setIsAlphabeticallySorted(true);
      try {
        const newOrderIds = sorted.map((s) => s.id);
        const updated = await invoke<VaultSummary>("reorder_services", { serviceIds: newOrderIds });
        setSummary(updated);
      } catch (err) {
        console.error("Failed to persist sorted services:", err);
      }
    } else {
      if (preSortOrderRef.current && preSortOrderRef.current.length > 0) {
        const orderMap = new Map(preSortOrderRef.current.map((id, idx) => [id, idx]));
        const restored = [...summary.services].sort((a, b) => {
          const idxA = orderMap.has(a.id) ? orderMap.get(a.id)! : 9999;
          const idxB = orderMap.has(b.id) ? orderMap.get(b.id)! : 9999;
          return idxA - idxB;
        });
        setSummary({ ...summary, services: restored });
        setIsAlphabeticallySorted(false);
        try {
          const newOrderIds = restored.map((s) => s.id);
          const updated = await invoke<VaultSummary>("reorder_services", { serviceIds: newOrderIds });
          setSummary(updated);
        } catch (err) {
          console.error("Failed to persist restored services:", err);
        }
      } else {
        setIsAlphabeticallySorted(false);
      }
    }
  };

  const handleConfirmBatchDelete = async () => {
    if (selectedServiceIds.length === 0) return;
    try {
      setError(null);
      const updated = await invoke<VaultSummary>("delete_multiple_services", {
        serviceIds: selectedServiceIds,
      });
      setSummary(updated);
      setSelectedServiceIds([]);
      setSelectionMode(false);
      setShowBatchDeleteModal(false);
    } catch (err: any) {
      setError(err?.toString() || "فشل حذف الخدمات المحددة");
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    try {
      setError(null);
      await invoke("create_vault", { password });
      setPassword("");
      await fetchSummary();
      setExists(true);
      setAutoUnlockActive(true);
    } catch (err: any) {
      setError(err?.toString() || "فشل إنشاء الخزنة");
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    try {
      setError(null);
      await invoke("unlock_vault", { password });
      setPassword("");
      await fetchSummary();
    } catch (err: any) {
      setError(err?.toString() || "فشل فتح الخزنة: كلمة المرور غير صحيحة");
    }
  };

  const handleLock = async () => {
    try {
      await invoke("lock_vault");
      setUnlocked(false);
      invoke("trim_app_memory").catch(() => {});
      setSummary(null);
      setSelectedServiceId(null);
      setPassword("");
      setShowAddService(false);
      setShowEditService(false);
      setShowAddAccount(false);
      setEditingAccount(null);
      setShowSettings(false);
      setServiceToDelete(null);
      setAccountToDelete(null);
      setError(null);
    } catch (err: any) {
      setError(err?.toString() || "فشل قفل الخزنة");
    }
  };

  // Toggle Auto-Unlock (Windows Credential Store)
  const handleToggleAutoUnlock = async () => {
    setSettingsFeedback(null);
    setError(null);
    if (autoUnlockActive) {
      try {
        await invoke("disable_auto_unlock");
        setAutoUnlockActive(false);
        setSavedPasswordHint(null);
        setShowSavedPassword(false);
        setSettingsFeedback({
          type: "success",
          message: "تم تعطيل الفتح التلقائي: سيُطلب منك رمز الدخول في كل مرة تفتح فيها كنانة.",
        });
      } catch (err: any) {
        setSettingsFeedback({
          type: "error",
          message: err?.toString() || "فشل تعطيل الفتح التلقائي",
        });
      }
    } else {
      // Open dedicated prompt dialog to enter password and enable
      setAutoUnlockPassword("");
      setAutoUnlockModalError(null);
      setShowAutoUnlockPassword(false);
      setShowAutoUnlockModal(true);
    }
  };

  // Confirm and activate Auto-Unlock with user-provided password
  const handleConfirmEnableAutoUnlock = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!autoUnlockPassword.trim()) {
      setAutoUnlockModalError("يرجى إدخال رمز الدخول أو كلمة المرور");
      return;
    }

    try {
      setAutoUnlockModalLoading(true);
      setAutoUnlockModalError(null);
      await invoke("enable_auto_unlock", { password: autoUnlockPassword.trim() });
      setAutoUnlockActive(true);
      setSavedPasswordHint(autoUnlockPassword.trim());
      setAutoUnlockPassword("");
      setShowAutoUnlockModal(false);
      setSettingsFeedback({
        type: "success",
        message: "تم تفعيل الفتح التلقائي بنجاح: سيتم فتح كنانة تلقائياً عند كل تشغيل.",
      });
    } catch (err: any) {
      const errStr = err?.toString() || "";
      if (
        errStr.toLowerCase().includes("invalid") ||
        errStr.toLowerCase().includes("password") ||
        errStr.toLowerCase().includes("decrypt") ||
        errStr.toLowerCase().includes("key")
      ) {
        setAutoUnlockModalError("رمز الدخول غير صحيح! يرجى التأكد من كتابة الرمز الصحيح للخزنة.");
      } else {
        setAutoUnlockModalError(errStr || "فشل تفعيل الفتح التلقائي");
      }
    } finally {
      setAutoUnlockModalLoading(false);
    }
  };

  // Change Master Password / PIN
  const handleChangeMasterPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMasterPassword) {
      setError("يرجى إدخال الرمز الجديد");
      return;
    }
    if (newMasterPassword !== confirmMasterPassword) {
      setError("الرمز وتأكيد الرمز غير متطابقين!");
      return;
    }
    try {
      setError(null);
      await invoke("change_master_password", { newPassword: newMasterPassword });
      setSavedPasswordHint(newMasterPassword);
      setNewMasterPassword("");
      setConfirmMasterPassword("");
      setPasswordChangeSuccess("تم تغيير رمز الدخول بنجاح وتحديث بيانات الحماية!");
      setTimeout(() => setPasswordChangeSuccess(null), 4000);
    } catch (err: any) {
      setError(err?.toString() || "فشل تغيير رمز الدخول");
    }
  };

  // Fetch Saved Password (silently populates savedPasswordHint if available without error toast)
  const handleFetchSavedPassword = async () => {
    try {
      const saved = await invoke<string>("get_current_saved_password");
      setSavedPasswordHint(saved);
    } catch {
      setSavedPasswordHint(null);
    }
  };

  // Fetch Emergency Recovery Key
  const handleFetchRecoveryKey = async () => {
    try {
      setError(null);
      const key = await invoke<string>("get_or_generate_recovery_key");
      setRecoveryKey(key);
    } catch (err: any) {
      setError(err?.toString() || "فشل توليد أو استرجاع مفتاح الطوارئ");
    }
  };

  // Recover Vault with Emergency Key
  const handleRecoverVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputRecoveryKey.trim()) return;
    try {
      setError(null);
      await invoke("recover_vault_with_key", { recoveryCode: inputRecoveryKey.trim() });
      setInputRecoveryKey("");
      setShowRecoveryModal(false);
      await fetchSummary();
      setError("تمت استعادة الخزنة بنجاح عبر مفتاح الطوارئ! يُنصح بتعيين رمز دخول جديد من الإعدادات.");
    } catch (err: any) {
      setError(err?.toString() || "فشل الاستعادة: مفتاح الطوارئ غير صحيح أو غير مطابق");
    }
  };

  // Export Vault Backup to .dat / .kinana file
  const handleExportVault = async () => {
    try {
      setIsProcessingBackup(true);
      setExportImportStatus(null);
      const savedPath = await invoke<string | null>("export_vault_backup");
      if (savedPath) {
        setExportImportStatus({
          type: "success",
          message: `تم تصدير نسخة الخزنة المشفرة بنجاح إلى:\n${savedPath}`,
        });
      }
    } catch (err: any) {
      setExportImportStatus({
        type: "error",
        message: err?.toString() || "فشل تصدير الخزنة",
      });
    } finally {
      setIsProcessingBackup(false);
    }
  };

  // Import Vault Backup from .dat / .kinana file
  const handleImportVault = async () => {
    try {
      setIsProcessingBackup(true);
      setExportImportStatus(null);
      const importedPath = await invoke<string | null>("import_vault_backup");
      if (importedPath) {
        setShowSettings(false);
        setUnlocked(false);
        setSummary(null);
        setSelectedServiceId(null);
        setPassword("");
        setExists(true);
        setError(`تم استيراد الخزنة بنجاح من: ${importedPath}. أدخل كلمة المرور الخاصة بها لفتحها.`);
      }
    } catch (err: any) {
      setExportImportStatus({
        type: "error",
        message: err?.toString() || "فشل استيراد الخزنة",
      });
    } finally {
      setIsProcessingBackup(false);
    }
  };

  // Open Vault File Location in Windows Explorer
  const handleOpenVaultFolder = async () => {
    try {
      await invoke("open_vault_folder");
    } catch (err: any) {
      setError(err?.toString() || "فشل فتح موقع الخزنة في المتصفح");
    }
  };

  // Generate Password Helper
  const handleGeneratePassword = async (target: "add" | "edit") => {
    try {
      const generated = await invoke<string>("generate_password", {
        length: 20,
        useSymbols: true,
      });
      if (target === "add") {
        setAccPassword(generated);
      } else {
        setEditPassword(generated);
      }
    } catch (err: any) {
      setError(err?.toString() || "فشل توليد كلمة المرور");
    }
  };

  // Add Service Handler
  const handleAddService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServiceName.trim()) {
      setAddServiceError("يرجى إدخال اسم الخدمة");
      return;
    }
    try {
      setAddServiceError(null);
      const updated = await invoke<VaultSummary>("add_service", {
        name: newServiceName.trim(),
        iconBase64: newServiceIcon || null,
      });
      setSummary(updated);
      setNewServiceName("");
      setNewServiceIcon(null);
      setShowAddService(false);
    } catch (err: any) {
      setAddServiceError(err?.toString() || "فشل إضافة التطبيق/الخدمة");
    }
  };

  // Open Edit Service Modal
  const openEditServiceModal = (service: ServiceSummary) => {
    setEditServiceName(service.name);
    setEditServiceIcon(service.icon_data || null);
    setEditServiceError(null);
    setShowEditService(true);
  };

  // Update Service Handler
  const handleUpdateService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedServiceId || !editServiceName.trim()) {
      setEditServiceError("يرجى إدخال اسم الخدمة");
      return;
    }
    try {
      setEditServiceError(null);
      const updated = await invoke<VaultSummary>("update_service", {
        serviceId: selectedServiceId,
        name: editServiceName.trim(),
        iconBase64: editServiceIcon || null,
        keepExistingIcon: false,
      });
      setSummary(updated);
      setShowEditService(false);
    } catch (err: any) {
      setEditServiceError(err?.toString() || "فشل تحديث بيانات الخدمة");
    }
  };

  // Confirm and Execute Service Deletion
  const confirmDeleteService = async (serviceId: string) => {
    try {
      setError(null);
      const updated = await invoke<VaultSummary>("delete_service", { serviceId });
      setSummary(updated);
      setSelectedServiceId(null);
      setServiceToDelete(null);
    } catch (err: any) {
      setError(err?.toString() || "فشل حذف الخدمة");
    }
  };

  // Add Account Handler (Supports both standard login accounts and dedicated bank cards)
  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedServiceId) return;
    try {
      setAddAccountError(null);
      let payloadLabel: string | null = null;
      let payloadUsername: string | null = null;
      let payloadPassword: string | null = null;
      let payloadEmail: string | null = null;
      let payloadRecoveryKey: string | null = null;
      let payloadUrl: string | null = null;
      let payloadNotes: string | null = null;

      if (accountFormMode === "card") {
        payloadLabel = accLabel.trim() || "بطاقة بنكية";
        payloadUsername = cardHolder.trim() || null;
        payloadPassword = cardNumber.replace(/\s+/g, "").trim() || null;
        payloadUrl = cardExpiry.trim() || null;
        payloadRecoveryKey = cardCvv.trim() || null;
        const extraNotes = accNotes.trim();
        const pinPart = cardPin.trim() ? `PIN: ${cardPin.trim()}` : "";
        const parts = ["[CARD]"];
        if (pinPart) parts.push(pinPart);
        if (extraNotes) parts.push(extraNotes);
        payloadNotes = parts.join("\n");
      } else {
        payloadLabel = accLabel.trim() || null;
        payloadUsername = accUsername.trim() || null;
        payloadPassword = accPassword.trim() || null;
        payloadEmail = accEmail.trim() || null;
        payloadRecoveryKey = accRecoveryKey.trim() || null;
        payloadNotes = accNotes.trim() || null;
        payloadUrl = accUrl.trim() || null;
      }

      const updated = await invoke<VaultSummary>("add_account", {
        serviceId: selectedServiceId,
        label: payloadLabel,
        username: payloadUsername,
        password: payloadPassword,
        email: payloadEmail,
        recoveryKey: payloadRecoveryKey,
        notes: payloadNotes,
        url: payloadUrl,
      });
      setSummary(updated);
      await fetchServiceAccounts(selectedServiceId);
      setAccLabel("");
      setAccUsername("");
      setAccEmail("");
      setAccPassword("");
      setAccRecoveryKey("");
      setAccUrl("");
      setAccNotes("");
      setCardHolder("");
      setCardNumber("");
      setCardExpiry("");
      setCardCvv("");
      setCardPin("");
      setShowAddAccount(false);
    } catch (err: any) {
      setAddAccountError(err?.toString() || "فشل إضافة الحساب");
    }
  };

  // Duplicate / Clone Account Handler (Pre-fills Add modal with cloned values)
  const handleDuplicateAccount = async (acc: AccountDetail) => {
    const isCard = isAccountCard(acc, selectedService?.name);
    setAccountFormMode(isCard ? "card" : "login");
    setAccLabel(`${acc.label || (isCard ? "بطاقة" : "حساب")} (نسخة)`);
    if (isCard) {
      setCardHolder(acc.username || "");
      setCardNumber("");
      setCardExpiry(acc.url || "");
      setCardCvv(acc.recovery_key || "");
      const pinM = acc.notes?.match(/PIN:\s*(\d{4,6})/i);
      setCardPin(pinM ? pinM[1] : "");
      const cleanNotes = acc.notes?.replace(/\[CARD\]/g, "").replace(/PIN:\s*\d{4,6}/gi, "").trim();
      setAccNotes(cleanNotes || "");
    } else {
      setAccUsername(acc.username);
      setAccEmail(acc.email);
      setAccRecoveryKey(acc.recovery_key);
      setAccUrl(acc.url);
      setAccNotes(acc.notes);
      setAccPassword("");
    }

    setAddAccountError(null);
    setShowAddAccount(true);
  };

  // Open Edit Account Modal
  const openEditAccountModal = (acc: AccountDetail) => {
    setEditingAccount(acc);
    const isCard = isAccountCard(acc, selectedService?.name);
    setAccountFormMode(isCard ? "card" : "login");
    setEditLabel(acc.label || "");
    if (isCard) {
      setCardHolder(acc.username || "");
      setCardNumber("");
      setCardExpiry(acc.url || "");
      setCardCvv(acc.recovery_key || "");
      const pinM = acc.notes?.match(/PIN:\s*(\d{4,6})/i);
      setCardPin(pinM ? pinM[1] : "");
      const cleanNotes = acc.notes?.replace(/\[CARD\]/g, "").replace(/PIN:\s*\d{4,6}/gi, "").trim();
      setEditNotes(cleanNotes || "");
    } else {
      setEditUsername(acc.username || "");
      setEditEmail(acc.email || "");
      setEditPassword("");
      setEditRecoveryKey(acc.recovery_key || "");
      setEditUrl(acc.url || "");
      setEditNotes(acc.notes || "");
    }
    setEditAccountError(null);
  };

  // Update Account Handler
  const handleUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedServiceId || !editingAccount) return;
    try {
      setEditAccountError(null);
      let payloadLabel: string | null = null;
      let payloadUsername: string | null = null;
      let payloadPassword: string | null = null;
      let payloadEmail: string | null = null;
      let payloadRecoveryKey: string | null = null;
      let payloadUrl: string | null = null;
      let payloadNotes: string | null = null;

      if (accountFormMode === "card") {
        payloadLabel = editLabel.trim() || "بطاقة بنكية";
        payloadUsername = cardHolder.trim() || null;
        payloadPassword = cardNumber.replace(/\s+/g, "").trim() ? cardNumber.replace(/\s+/g, "").trim() : null;
        payloadUrl = cardExpiry.trim() || null;
        payloadRecoveryKey = cardCvv.trim() || null;
        const extraNotes = editNotes.trim();
        const pinPart = cardPin.trim() ? `PIN: ${cardPin.trim()}` : "";
        const parts = ["[CARD]"];
        if (pinPart) parts.push(pinPart);
        if (extraNotes) parts.push(extraNotes);
        payloadNotes = parts.join("\n");
      } else {
        payloadLabel = editLabel.trim() || null;
        payloadUsername = editUsername.trim() || null;
        payloadPassword = editPassword.trim() ? editPassword : null;
        payloadEmail = editEmail.trim() || null;
        payloadRecoveryKey = editRecoveryKey.trim() || null;
        payloadNotes = editNotes.trim() || null;
        payloadUrl = editUrl.trim() || null;
      }

      const updated = await invoke<VaultSummary>("update_account", {
        serviceId: selectedServiceId,
        accountId: editingAccount.id,
        label: payloadLabel,
        username: payloadUsername,
        password: payloadPassword,
        email: payloadEmail,
        recoveryKey: payloadRecoveryKey,
        notes: payloadNotes,
        url: payloadUrl,
      });
      setSummary(updated);
      await fetchServiceAccounts(selectedServiceId);
      setEditingAccount(null);
    } catch (err: any) {
      setEditAccountError(err?.toString() || "فشل تحديث بيانات الحساب");
    }
  };

  // Confirm and Execute Account Deletion
  const confirmDeleteAccount = async (serviceId: string, accountId: string) => {
    try {
      setError(null);
      const updated = await invoke<VaultSummary>("delete_account", { serviceId, accountId });
      setSummary(updated);
      await fetchServiceAccounts(serviceId);
      setAccountToDelete(null);
    } catch (err: any) {
      setError(err?.toString() || "فشل حذف الحساب");
    }
  };

  // Universal Field Copy Handler
  const copyFieldValue = async (accountId: string, field: string, value: string) => {
    if (!value) return;
    try {
      if (field === "password" || field === "recovery_key") {
        await invoke("copy_secure_text", { text: value });
      } else {
        await navigator.clipboard.writeText(value);
      }
      setCopiedKey(`${accountId}_${field}`);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (err: any) {
      setError(err?.toString() || "فشل نسخ القيمة");
    }
  };

  // Open URL in the user's default system browser
  const handleOpenUrl = async (rawUrl: string) => {
    if (!rawUrl) return;
    let target = rawUrl.trim();
    if (!/^https?:\/\//i.test(target)) {
      target = "https://" + target;
    }
    try {
      await invoke("open_url", { url: target });
    } catch (err) {
      console.error("Failed to open URL via backend:", err);
      window.open(target, "_blank");
    }
  };

  // Dedicated Password Copy Handler (via native Windows secure clipboard)
  const copyAccountPassword = async (serviceId: string, accountId: string) => {
    try {
      await invoke("copy_password", { serviceId, accountId });
      setCopiedKey(`${accountId}_password`);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch (err: any) {
      setError(err?.toString() || "فشل نسخ كلمة المرور");
    }
  };

  // Image upload with automated canvas resizing
  const onImageFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (val: string | null) => void,
    setErr?: (err: string | null) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) {
      setter(null);
      return;
    }
    if (setErr) setErr(null);
    try {
      const base64 = await processImageUpload(file);
      setter(base64);
    } catch (err: any) {
      const msg = err?.toString() || "فشل معالجة الصورة";
      if (setErr) setErr(msg);
      else setError(msg);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center font-sans bg-background text-muted-foreground">
        <div className="text-center space-y-6">
          <img
            src={kinanaLogo}
            alt="كنانة"
            className="h-20 w-auto object-contain mx-auto animate-pulse drop-shadow-lg"
          />
          <div className="flex items-center justify-center gap-3 text-lg font-medium">
            <RefreshCw className="w-5 h-5 animate-spin text-primary" />
            <span>جاري فتح كنانة والتحقق من الأمان...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-background text-foreground font-sans flex flex-col selection:bg-primary selection:text-primary-foreground relative"
      dir="rtl"
    >
      {/* On-Screen Zoom HUD Toast */}
      {zoomHud.visible && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-300">
          <div className="bg-primary text-primary-foreground font-bold px-6 py-2.5 rounded-full shadow-2xl border border-primary-foreground/20 flex items-center gap-2.5 text-base">
            <ZoomIn className="w-5 h-5" />
            <span>نسبة التكبير: {zoomHud.text}</span>
          </div>
        </div>
      )}

      {/* Fullscreen Floating Exit Pill (Auto-hides after 4.5s, reveals on top hover) */}
      {isFullscreen && (
        <div
          className={`fixed top-3 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ease-out transform ${
            showFullscreenPill
              ? "opacity-100 translate-y-0 pointer-events-auto"
              : "opacity-0 -translate-y-4 pointer-events-none"
          }`}
          onMouseEnter={() => {
            if (fullscreenPillTimerRef.current) clearTimeout(fullscreenPillTimerRef.current);
          }}
          onMouseLeave={() => {
            if (fullscreenPillTimerRef.current) clearTimeout(fullscreenPillTimerRef.current);
            fullscreenPillTimerRef.current = setTimeout(() => {
              setShowFullscreenPill(false);
            }, 1500);
          }}
        >
          <button
            type="button"
            onClick={handleToggleFullscreen}
            className="bg-card/95 backdrop-blur-md border border-border/80 text-foreground px-5 py-2 rounded-full shadow-2xl flex items-center gap-2.5 text-xs font-bold hover:bg-muted hover:border-primary/50 transition-all cursor-pointer"
          >
            <Minimize2 className="w-4 h-4 text-primary" />
            <span>الخروج من وضع ملء الشاشة (F11 أو Esc)</span>
          </button>
        </div>
      )}

      {/* Floating Centered Shadcn Alert / Toast Notification */}
      {error && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] w-full max-w-lg px-4 pointer-events-auto animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="bg-destructive/15 backdrop-blur-xl border-2 border-destructive/40 text-destructive-foreground rounded-2xl shadow-2xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-5 h-5 text-destructive shrink-0" />
              <span className="text-sm font-bold leading-normal">{error}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setError(null)}
              className="text-destructive-foreground hover:bg-destructive/20 rounded-xl h-8 w-8 p-0 shrink-0 ml-2"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {!unlocked ? (
        /* ================= AUTHENTICATION VIEW (LOCK SCREEN) ================= */
        <main className="flex-1 flex items-center justify-center p-8 bg-gradient-to-b from-background via-card/30 to-background">
          <Card className="w-full max-w-2xl border-border/80 shadow-2xl backdrop-blur-xl bg-card/95 p-6 sm:p-8 rounded-3xl">
            <CardHeader className="text-center pb-6 pt-6">
              <div className="flex justify-center mb-4">
                <img
                  src={kinanaLogo}
                  alt="كنانة"
                  className="h-28 sm:h-32 w-auto object-contain drop-shadow-xl"
                />
              </div>
              <CardDescription className="text-lg text-muted-foreground font-medium pt-1 font-sans">
                خزنة كلمات المرور الآمنة والمشفرة محلياً بالكامل
              </CardDescription>
            </CardHeader>

            <CardContent className="px-6 sm:px-10 pb-8 pt-2">
              {!exists ? (
                <form onSubmit={handleCreate} className="space-y-6">
                  <div className="p-5 rounded-2xl bg-muted/40 border border-border/50 text-base text-muted-foreground leading-relaxed flex items-start gap-3">
                    <ShieldCheck className="w-6 h-6 text-primary shrink-0 mt-0.5" />
                    <span>
                      لم يتم العثور على خزنة سابقة. قم بإنشاء خزنتك الآن بتعيين كلمة مرور رئيسية أو رمز
                      PIN قوي:
                    </span>
                  </div>

                  <div>
                    <label className="block text-base font-bold text-foreground mb-2.5">
                      كلمة المرور الرئيسية أو رمز PIN:
                    </label>
                    <div className="relative">
                      <Input
                        type={showCreatePassword ? "text" : "password"}
                        placeholder="أدخل كلمة مرور قوية أو رمز PIN"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-16 text-xl text-center rounded-2xl tracking-wider font-sans border-2 pl-14"
                        autoFocus
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowCreatePassword(!showCreatePassword)}
                        className="absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 text-muted-foreground hover:text-foreground"
                        title={showCreatePassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                      >
                        {showCreatePassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </Button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    className="w-full h-16 text-xl font-bold shadow-xl rounded-2xl gap-2"
                  >
                    <ShieldCheck className="w-6 h-6" />
                    <span>إنشاء الخزنة وبدء الاستخدام</span>
                  </Button>

                  <div className="pt-4 text-center border-t border-border/40">
                    <button
                      type="button"
                      onClick={handleImportVault}
                      className="text-sm font-semibold text-muted-foreground hover:text-primary inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Upload className="w-4 h-4 text-primary" />
                      <span>هل لديك نسخة سابقة من جهاز آخر؟ استيراد الخزنة (.dat)</span>
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleUnlock} className="space-y-6">
                  <div>
                    <label className="block text-base font-bold text-foreground text-center mb-2.5">
                      أدخل رمز الدخول أو كلمة المرور الرئيسية:
                    </label>
                    <div className="relative">
                      <Input
                        type={showUnlockPassword ? "text" : "password"}
                        placeholder="••••••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="h-16 text-2xl text-center tracking-widest font-sans rounded-2xl border-2 pl-14"
                        autoFocus
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setShowUnlockPassword(!showUnlockPassword)}
                        className="absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 text-muted-foreground hover:text-foreground"
                        title={showUnlockPassword ? "إخفاء الرمز" : "إظهار الرمز"}
                      >
                        {showUnlockPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3.5 pt-2">
                    <Button
                      type="submit"
                      className="w-full h-16 text-xl font-bold shadow-xl rounded-2xl gap-2.5"
                    >
                      <Unlock className="w-6 h-6" />
                      <span>فتح الخزنة</span>
                    </Button>

                    {autoUnlockActive && (
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full h-14 text-base font-semibold rounded-2xl gap-2 border border-border/60"
                        onClick={async () => {
                          try {
                            const ok = await invoke<boolean>("auto_unlock_vault");
                            if (ok) await fetchSummary();
                            else setError("فشل الفتح التلقائي: لم يتم العثور على رمز دخول محفوظ");
                          } catch (e: any) {
                            const errStr = e?.toString() || "";
                            if (errStr.includes("No saved credential")) {
                              setError("لم يتم العثور على رمز دخول محفوظ في مخزن ويندوز. يرجى إدخال الرمز يدوياً.");
                            } else {
                              setError(errStr || "فشل الفتح التلقائي");
                            }
                          }
                        }}
                      >
                        <Shield className="w-5 h-5 text-primary" />
                        <span>فتح تلقائياً بدون كلمة مرور</span>
                      </Button>
                    )}
                  </div>

                  {/* Recovery and Import links */}
                  <div className="pt-4 flex flex-col items-center gap-2.5 border-t border-border/40">
                    <button
                      type="button"
                      onClick={() => setShowRecoveryModal(true)}
                      className="text-sm font-semibold text-muted-foreground hover:text-foreground underline underline-offset-4 inline-flex items-center gap-1.5 transition-colors"
                    >
                      <KeyRound className="w-4 h-4 text-primary" />
                      <span>نسيت كلمة المرور؟ استعادة الخزنة عبر مفتاح الطوارئ</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleImportVault}
                      className="text-xs font-semibold text-muted-foreground hover:text-primary inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-primary" />
                      <span>استيراد أو تبديل الخزنة من ملف (.dat)</span>
                    </button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </main>
      ) : (
        /* ================= UNLOCKED MAIN VAULT VIEW ================= */
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              onPointerDown={handleBackgroundPointerDown}
              className="flex-1 flex flex-col min-h-screen w-full select-none"
            >
              {/* Windows-style Marquee Selection Box */}
              {marqueeBox && (
                <div
                  className="fixed pointer-events-none z-50 rounded-md border-2 border-primary/80 bg-primary/20 backdrop-blur-[2px] shadow-lg transition-none"
                  style={{
                    left: `${marqueeBox.left}px`,
                    top: `${marqueeBox.top}px`,
                    width: `${marqueeBox.width}px`,
                    height: `${marqueeBox.height}px`,
                  }}
                />
              )}

              {/* Top Navigation Bar: Hidden completely during Fullscreen Mode! */}
          {!isFullscreen && (
            <header className="bg-card/85 backdrop-blur-xl border-b border-border/70 px-6 py-3 flex items-center justify-between gap-4 sticky top-0 z-30 shadow-md">
              {/* Right: App Brand & Status */}
              <div className="flex items-center space-x-4 space-x-reverse shrink-0">
                <img
                  src={kinanaLogo}
                  alt="كنانة"
                  className="h-10 w-auto object-contain cursor-pointer drop-shadow-sm"
                  title="كنانة"
                />
                <Badge
                  variant="secondary"
                  className="px-3 py-1 font-bold text-xs rounded-full border border-border/60"
                >
                  مفتوحة ({summary?.total_services ?? 0} خدمات / {summary?.total_accounts ?? 0} حساب)
                </Badge>
              </div>

              {/* Center: Toolbar (Icons Only) */}
              <div className="flex items-center gap-2 bg-muted/60 p-1.5 rounded-2xl border border-border/70 shadow-sm backdrop-blur-md">
                {/* View options menu / toggle & Sort A-Z */}
                <div className="flex items-center bg-card rounded-xl p-0.5 border border-border/50 shadow-sm">
                  <Button
                    variant={viewMode === "netflix" ? "default" : "ghost"}
                    size="icon"
                    onClick={() => toggleViewMode("netflix")}
                    className={`h-9 w-9 rounded-lg ${
                      viewMode === "netflix"
                        ? "shadow-sm text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title="عرض شبكة"
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </Button>
                  <Button
                    variant={viewMode === "list" ? "default" : "ghost"}
                    size="icon"
                    onClick={() => toggleViewMode("list")}
                    className={`h-9 w-9 rounded-lg ${
                      viewMode === "list"
                        ? "shadow-sm text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title="عرض قائمة"
                  >
                    <List className="w-4 h-4" />
                  </Button>
                  <Button
                    variant={isAlphabeticallySorted ? "default" : "ghost"}
                    size="icon"
                    onClick={handleToggleSortAlphabetically}
                    className={`h-9 w-9 rounded-lg transition-all ${
                      isAlphabeticallySorted
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                    title={
                      isAlphabeticallySorted
                        ? "إلغاء الترتيب الأبجدي واستعادة الترتيب السابق"
                        : "ترتيب الخدمات أبجدياً (أ - ي)"
                    }
                  >
                    <ArrowDownAZ className="w-4 h-4" />
                  </Button>
                  <Button
                    variant={selectionMode ? "default" : "ghost"}
                    size="icon"
                    onClick={() => {
                      if (selectionMode) {
                        setSelectionMode(false);
                        setSelectedServiceIds([]);
                      } else {
                        setSelectionMode(true);
                      }
                    }}
                    className={`h-9 w-9 rounded-lg transition-all ${
                      selectionMode
                        ? "bg-amber-500 text-black font-bold shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                    title={selectionMode ? "إلغاء وضع التحديد" : "وضع تحديد وحذف خدمات متعددة"}
                  >
                    <CheckSquare className="w-4 h-4" />
                  </Button>
                </div>

                {/* Netflix Card Title Visibility Toggle - Icon Only */}
                {viewMode === "netflix" && (
                  <Button
                    variant={showCardTitles ? "secondary" : "ghost"}
                    size="icon"
                    onClick={toggleShowCardTitles}
                    className="h-9 w-9 rounded-xl border border-border/50 shadow-sm bg-card hover:bg-muted"
                    title={
                      showCardTitles
                        ? "إخفاء أسماء الخدمات على البطاقات (العرض النظيف)"
                        : "إظهار أسماء الخدمات دائماً على البطاقات"
                    }
                  >
                    {showCardTitles ? (
                      <Eye className="w-4 h-4 text-primary" />
                    ) : (
                      <EyeOff className="w-4 h-4 text-muted-foreground" />
                    )}
                  </Button>
                )}

                <div className="w-px h-5 bg-border/80" />

                {/* Zoom Controls */}
                <div className="flex items-center bg-card rounded-xl p-0.5 border border-border/50 shadow-sm" dir="ltr">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => applyZoom(zoomLevel - 0.1)}
                    className="h-9 w-9 rounded-lg hover:bg-muted"
                    title="تصغير (Ctrl + -)"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </Button>
                  <button
                    type="button"
                    onClick={() => applyZoom(1.0)}
                    className="px-2 font-bold text-xs hover:text-primary transition-colors"
                    title="إعادة ضبط الحجم إلى 100% (Ctrl + 0)"
                  >
                    {Math.round(zoomLevel * 100)}%
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => applyZoom(zoomLevel + 0.1)}
                    className="h-9 w-9 rounded-lg hover:bg-muted"
                    title="تكبير (Ctrl + =)"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </Button>
                </div>

                <div className="w-px h-5 bg-border/80" />

                {/* + إضافة خدمة Button - Icon Only as requested! */}
                <Button
                  size="icon"
                  onClick={() => {
                    setAddServiceError(null);
                    setShowAddService(true);
                  }}
                  className="h-9 w-9 rounded-xl shadow-md bg-primary hover:bg-primary/90 text-primary-foreground"
                  title="إضافة خدمة أو تطبيق جديد"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {/* Left: Action Buttons (Fullscreen button removed, F11 shortcut works) */}
              <div className="flex items-center space-x-2 space-x-reverse shrink-0">
                {/* Quick Export Vault */}
                <Button
                  variant="outline"
                  size="icon"
                  disabled={isProcessingBackup}
                  onClick={handleExportVault}
                  className="h-10 w-10 rounded-xl border-border/80 shadow-sm text-white hover:text-white hover:bg-muted transition-colors"
                  title="تصدير نسخة احتياطية من الخزنة (.dat)"
                >
                  <Download className="w-4 h-4 text-white" />
                </Button>

                {/* Quick Import Vault */}
                <Button
                  variant="outline"
                  size="icon"
                  disabled={isProcessingBackup}
                  onClick={handleImportVault}
                  className="h-10 w-10 rounded-xl border-border/80 shadow-sm text-white hover:text-white hover:bg-muted transition-colors"
                  title="استيراد خزنة من ملف (.dat)"
                >
                  <Upload className="w-4 h-4 text-white" />
                </Button>

                {/* Open Vault Folder in Windows */}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleOpenVaultFolder}
                  className="h-10 w-10 rounded-xl border-border/80 shadow-sm text-white hover:text-white hover:bg-muted transition-colors"
                  title="فتح مسار ملف الخزنة في ويندوز (Explorer)"
                >
                  <FolderOpen className="w-4 h-4 text-white" />
                </Button>

                {/* Settings & Master Password Change */}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    setSettingsFeedback(null);
                    setShowSettings(true);
                    handleFetchSavedPassword();
                    handleFetchRecoveryKey();
                  }}
                  className="h-10 w-10 rounded-xl border-border/80 shadow-sm text-white hover:text-white hover:bg-muted transition-colors"
                  title="إعدادات الأمان واستعادة الخزنة"
                >
                  <Settings className="w-4 h-4 text-white" />
                </Button>

                {/* Lock */}
                <Button
                  variant="destructive"
                  onClick={handleLock}
                  className="h-10 px-4 rounded-xl gap-2 font-bold shadow-sm text-xs"
                >
                  <Lock className="w-4 h-4" />
                  <span>قفل</span>
                </Button>
              </div>
            </header>
          )}

          {/* Main Services View: Zoom applied only to content so Header stays pinned and crisp! */}
          <main
            style={{ zoom: zoomLevel }}
            className="flex-1 p-8 sm:p-10 max-w-7xl mx-auto w-full transition-[zoom] duration-150 min-h-[calc(100vh-80px)] select-none"
          >
            {summary && summary.services.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-28 space-y-5">
                <button
                  type="button"
                  onClick={() => {
                    setAddServiceError(null);
                    setShowAddService(true);
                  }}
                  className="group relative w-28 h-28 sm:w-32 sm:h-32 rounded-3xl bg-muted/40 hover:bg-muted/80 border-2 border-dashed border-border/80 hover:border-primary flex items-center justify-center text-muted-foreground hover:text-primary transition-all duration-300 hover:scale-105 hover:shadow-2xl cursor-pointer"
                  title="إضافة خدمة جديدة"
                >
                  <Plus className="w-12 h-12 transition-transform duration-300 group-hover:rotate-90 group-hover:scale-110" />
                </button>
                <h3 className="text-2xl font-bold font-thamaniah text-foreground">
                  لا توجد خدمات مضافة حتى الآن
                </h3>
              </div>
            ) : viewMode === "netflix" ? (
              /* Option 1: Netflix Widescreen Cover Grid (Pointer Drag, Selection Checkbox, ContextMenu) */
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-7">
                {displayedServices.map((service) => (
                  <ContextMenu key={service.id}>
                    <ContextMenuTrigger asChild>
                      <Card
                        data-service-id={service.id}
                        onPointerDown={(e) => handlePointerDown(e, service.id)}
                        onClick={() => handleCardClick(service.id)}
                        className={`group cursor-grab active:cursor-grabbing border-2 transition-all duration-200 bg-card rounded-2xl overflow-hidden relative aspect-video flex flex-col justify-end shadow-md ${
                          draggedServiceId === service.id
                            ? "opacity-30 scale-95 border-dashed border-primary ring-4 ring-primary/40 shadow-2xl"
                            : selectionMode && selectedServiceIds.includes(service.id)
                            ? "border-primary ring-2 ring-primary/60 bg-primary/10 shadow-lg scale-[1.02]"
                            : "border-border/70 hover:border-primary hover:scale-[1.03]"
                        }`}
                      >
                        {/* Pinned Badge (Top Left in RTL) */}
                        {pinnedServiceIds.includes(service.id) && (
                          <div
                            className="absolute top-3 left-3 z-20 bg-black/70 backdrop-blur-md text-white p-1.5 rounded-xl border border-white/20 shadow-md flex items-center justify-center pointer-events-none"
                            title="خدمة مثبتة في البداية"
                          >
                            <Pin className="w-3.5 h-3.5 fill-white text-white rotate-45" />
                          </div>
                        )}

                        {/* Selection Checkbox Pill (Top Right in RTL) */}
                        {selectionMode && (
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelectService(service.id);
                            }}
                            className="absolute top-3 right-3 z-30 transition-transform active:scale-90"
                          >
                            <div
                              className={`w-7 h-7 rounded-xl flex items-center justify-center transition-all shadow-lg ${
                                selectedServiceIds.includes(service.id)
                                  ? "bg-primary text-primary-foreground ring-2 ring-white/60 scale-110"
                                  : "bg-black/60 text-white/50 border border-white/20 hover:bg-black/80"
                              }`}
                            >
                              {selectedServiceIds.includes(service.id) ? (
                                <Check className="w-4 h-4 stroke-[3]" />
                              ) : (
                                <div className="w-2.5 h-2.5 rounded-sm border border-white/40" />
                              )}
                            </div>
                          </div>
                        )}

                        {/* Cover Background: Blurred ambient glow backdrop + object-contain foreground */}
                        {service.icon_data ? (
                          <div className="absolute inset-0 w-full h-full overflow-hidden bg-zinc-950 flex items-center justify-center pointer-events-none select-none">
                            {/* Ambient glow blurred backdrop */}
                            <img
                              src={service.icon_data}
                              alt=""
                              draggable={false}
                              aria-hidden="true"
                              className="absolute inset-0 w-full h-full object-cover blur-2xl opacity-40 scale-125 pointer-events-none select-none"
                            />
                            {/* Sharp logo preserved with full true aspect ratio */}
                            <img
                              src={service.icon_data}
                              alt={service.name}
                              draggable={false}
                              className="relative z-0 w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-500 drop-shadow-md pointer-events-none select-none"
                            />
                            {/* Gradient overlay */}
                            <div
                              className={`absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent pointer-events-none select-none transition-opacity duration-300 ${
                                showCardTitles ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                              }`}
                            />
                          </div>
                        ) : (
                          <div
                            className={`absolute inset-0 w-full h-full bg-gradient-to-br ${getServiceGradient(
                              service.name
                            )} flex items-center justify-center group-hover:scale-105 transition-transform duration-500 pointer-events-none select-none`}
                          >
                            <div className="absolute inset-0 bg-black/20 pointer-events-none select-none" />
                            <span className="relative text-7xl font-black text-white/90 font-thamaniah drop-shadow-2xl select-none pointer-events-none">
                              {service.name.charAt(0).toUpperCase()}
                            </span>
                            <div
                              className={`absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent pointer-events-none select-none transition-opacity duration-300 ${
                                showCardTitles ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                              }`}
                            />
                          </div>
                        )}

                        {/* Service Title Bar: Always visible if showCardTitles, or revealed on hover */}
                        <div
                          className={`relative z-10 px-5 py-4 w-full flex items-center transition-opacity duration-300 pointer-events-none select-none ${
                            showCardTitles ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                          }`}
                        >
                          <h4 className="text-2xl font-black font-thamaniah text-white drop-shadow-lg truncate pointer-events-none select-none">
                            {service.name}
                          </h4>
                        </div>
                      </Card>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-56 rounded-2xl bg-card/95 backdrop-blur-md border border-border/80 shadow-2xl p-1.5 text-right font-medium text-sm">
                      <ContextMenuItem
                        onClick={() => setSelectedServiceId(service.id)}
                        className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2 font-bold"
                      >
                        <span>تعديل البيانات والحسابات</span>
                        <KeyRound className="w-4 h-4 text-white" />
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => openEditServiceModal(service)}
                        className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2"
                      >
                        <span>تعديل الخدمة والشعار</span>
                        <Pencil className="w-4 h-4 text-white" />
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => handleDuplicateService(service.id)}
                        className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2"
                      >
                        <span>تكرار الخدمة</span>
                        <Copy className="w-4 h-4 text-white" />
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => togglePinService(service.id)}
                        className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2"
                      >
                        <span>{pinnedServiceIds.includes(service.id) ? "إلغاء تثبيت الخدمة" : "تثبيت في البداية"}</span>
                        {pinnedServiceIds.includes(service.id) ? (
                          <PinOff className="w-4 h-4 text-white" />
                        ) : (
                          <Pin className="w-4 h-4 text-white" />
                        )}
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => enterSelectionModeWithService(service.id)}
                        className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2"
                      >
                        <span>تحديد وحذف</span>
                        <CheckSquare className="w-4 h-4 text-white" />
                      </ContextMenuItem>
                      <ContextMenuSeparator className="my-1 bg-border/60" />
                      <ContextMenuItem
                        onClick={() => setServiceToDelete(service)}
                        className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-destructive/20 text-destructive transition-colors gap-2"
                      >
                        <span>حذف</span>
                        <Trash2 className="w-4 h-4 text-white" />
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </div>
            ) : (
              /* Option 2: Compact List View with Small Images & Account Count Badge & Action Buttons */
              <div className="space-y-4 max-w-5xl mx-auto">
                {displayedServices.map((service) => (
                  <ContextMenu key={service.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        data-service-id={service.id}
                        onPointerDown={(e) => handlePointerDown(e, service.id)}
                        onClick={() => handleCardClick(service.id)}
                        className={`group cursor-grab active:cursor-grabbing p-5 rounded-2xl border-2 bg-card/90 hover:bg-card transition-all duration-200 hover:shadow-lg flex items-center justify-between gap-6 ${
                          draggedServiceId === service.id
                            ? "opacity-30 scale-[0.98] border-dashed border-primary ring-4 ring-primary/40 shadow-2xl"
                            : selectionMode && selectedServiceIds.includes(service.id)
                            ? "border-primary ring-2 ring-primary/60 bg-primary/10 shadow-md"
                            : "border-border/70 hover:border-primary/80"
                        }`}
                      >
                        <div className="flex items-center gap-5 min-w-0 pointer-events-none select-none">
                          {/* Selection Checkbox in List Row */}
                          {selectionMode && (
                            <div
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSelectService(service.id);
                              }}
                              className="shrink-0 transition-transform active:scale-90 pointer-events-auto cursor-pointer"
                            >
                              <div
                                className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all shadow-md ${
                                  selectedServiceIds.includes(service.id)
                                    ? "bg-primary text-primary-foreground ring-2 ring-primary/40 scale-110"
                                    : "bg-muted text-muted-foreground border border-border hover:bg-muted/80"
                                }`}
                              >
                                {selectedServiceIds.includes(service.id) ? (
                                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                                ) : (
                                  <div className="w-2 h-2 rounded-xs border border-border" />
                                )}
                              </div>
                            </div>
                          )}

                          <GripVertical className="w-5 h-5 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 pointer-events-none" />
                          {service.icon_data ? (
                            <div className="w-16 h-16 rounded-xl overflow-hidden p-1.5 bg-zinc-950/80 border border-border/50 shrink-0 shadow-sm group-hover:scale-105 transition-transform flex items-center justify-center pointer-events-none">
                              <img
                                src={service.icon_data}
                                alt={service.name}
                                draggable={false}
                                className="w-full h-full object-contain rounded-lg pointer-events-none select-none"
                              />
                            </div>
                          ) : (
                            <div
                              className={`w-16 h-16 rounded-xl bg-gradient-to-br ${getServiceGradient(
                                service.name
                              )} flex items-center justify-center text-white text-2xl font-black font-thamaniah shrink-0 shadow-sm group-hover:scale-105 transition-transform pointer-events-none`}
                            >
                              {service.name.charAt(0).toUpperCase()}
                            </div>
                          )}

                          <div className="truncate pointer-events-none">
                            <div className="flex items-center gap-2">
                              <h4 className="text-2xl font-bold font-thamaniah text-foreground group-hover:text-primary transition-colors truncate pointer-events-none">
                                {service.name}
                              </h4>
                              {pinnedServiceIds.includes(service.id) && (
                                <span
                                  className="inline-flex items-center gap-1 bg-white/10 text-white text-[11px] px-2 py-0.5 rounded-lg font-bold shrink-0 pointer-events-none border border-white/20"
                                  title="خدمة مثبتة"
                                >
                                  <Pin className="w-3 h-3 fill-white rotate-45" />
                                  <span>مثبتة</span>
                                </span>
                              )}
                            </div>
                            <span className="text-sm text-muted-foreground font-medium pointer-events-none">
                              انقر لفتح الحسابات وإدارة كلمات المرور
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {/* Quick Actions: تعديل البيانات، تعديل الخدمة، تكرار، تثبيت، حذف */}
                          <div className="flex items-center gap-1.5 bg-muted/40 p-1.5 rounded-xl border border-border/50">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedServiceId(service.id);
                              }}
                              className="h-8 w-8 rounded-lg hover:bg-muted text-white transition-colors"
                              title="تعديل البيانات والحسابات"
                            >
                              <KeyRound className="w-4 h-4 text-white" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditServiceModal(service);
                              }}
                              className="h-8 w-8 rounded-lg hover:bg-muted text-white transition-colors"
                              title="تعديل اسم وشعار الخدمة"
                            >
                              <Pencil className="w-4 h-4 text-white" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicateService(service.id);
                              }}
                              className="h-8 w-8 rounded-lg hover:bg-muted text-white transition-colors"
                              title="تكرار الخدمة"
                            >
                              <Copy className="w-4 h-4 text-white" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePinService(service.id);
                              }}
                              className={`h-8 w-8 rounded-lg transition-colors ${
                                pinnedServiceIds.includes(service.id)
                                  ? "bg-white/20 text-white"
                                  : "text-white/70 hover:text-white hover:bg-muted"
                              }`}
                              title={
                                pinnedServiceIds.includes(service.id)
                                  ? "إلغاء تثبيت الخدمة"
                                  : "تثبيت الخدمة في البداية"
                              }
                            >
                              {pinnedServiceIds.includes(service.id) ? (
                                <PinOff className="w-4 h-4 text-white" />
                              ) : (
                                <Pin className="w-4 h-4 text-white" />
                              )}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => {
                                e.stopPropagation();
                                setServiceToDelete(service);
                              }}
                              className="h-8 w-8 rounded-lg hover:bg-destructive/20 hover:text-destructive text-white transition-colors"
                              title="حذف الخدمة"
                            >
                              <Trash2 className="w-4 h-4 text-white" />
                            </Button>
                          </div>

                          <Badge
                            variant="secondary"
                            className="px-4 py-2 font-bold text-sm rounded-xl border border-border/60 pointer-events-none"
                          >
                            {service.accounts.length === 1
                              ? "حساب واحد"
                              : `${service.accounts.length} حسابات`}
                          </Badge>
                        </div>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-56 rounded-2xl bg-card/95 backdrop-blur-md border border-border/80 shadow-2xl p-1.5 text-right font-medium text-sm">
                      <ContextMenuItem
                        onClick={() => setSelectedServiceId(service.id)}
                        className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2 font-bold"
                      >
                        <span>تعديل البيانات والحسابات</span>
                        <KeyRound className="w-4 h-4 text-white" />
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => openEditServiceModal(service)}
                        className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2"
                      >
                        <span>تعديل الخدمة والشعار</span>
                        <Pencil className="w-4 h-4 text-white" />
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => handleDuplicateService(service.id)}
                        className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2"
                      >
                        <span>تكرار الخدمة</span>
                        <Copy className="w-4 h-4 text-white" />
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => togglePinService(service.id)}
                        className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2"
                      >
                        <span>{pinnedServiceIds.includes(service.id) ? "إلغاء تثبيت الخدمة" : "تثبيت في البداية"}</span>
                        {pinnedServiceIds.includes(service.id) ? (
                          <PinOff className="w-4 h-4 text-white" />
                        ) : (
                          <Pin className="w-4 h-4 text-white" />
                        )}
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => enterSelectionModeWithService(service.id)}
                        className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2"
                      >
                        <span>تحديد وحذف</span>
                        <CheckSquare className="w-4 h-4 text-white" />
                      </ContextMenuItem>
                      <ContextMenuSeparator className="my-1 bg-border/60" />
                      <ContextMenuItem
                        onClick={() => setServiceToDelete(service)}
                        className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-destructive/20 text-destructive transition-colors gap-2"
                      >
                        <span>حذف</span>
                        <Trash2 className="w-4 h-4 text-white" />
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))}
              </div>
            )}
          </main>

          {/* Floating Batch Selection Toolbar */}
          {selectionMode && (
            <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-5 duration-300">
              <div className="bg-card/95 backdrop-blur-2xl border-2 border-primary/50 shadow-2xl rounded-2xl px-6 py-3.5 flex items-center gap-5 text-foreground">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <CheckSquare className="w-5 h-5 text-primary" />
                  <span>تم تحديد {selectedServiceIds.length} من {summary?.services.length || 0}</span>
                </div>

                <div className="h-5 w-[1px] bg-border" />

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (selectedServiceIds.length === (summary?.services.length || 0)) {
                        setSelectedServiceIds([]);
                      } else {
                        setSelectedServiceIds(summary?.services.map((s) => s.id) || []);
                      }
                    }}
                    className="h-9 px-3 rounded-xl gap-1.5 font-bold text-xs"
                  >
                    {selectedServiceIds.length === (summary?.services.length || 0) ? (
                      <>
                        <Square className="w-3.5 h-3.5" />
                        <span>إلغاء تحديد الكل</span>
                      </>
                    ) : (
                      <>
                        <CheckCheck className="w-3.5 h-3.5 text-primary" />
                        <span>تحديد الكل</span>
                      </>
                    )}
                  </Button>

                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={selectedServiceIds.length === 0}
                    onClick={() => setShowBatchDeleteModal(true)}
                    className="h-9 px-4 rounded-xl gap-2 font-bold text-xs shadow-md"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>حذف المحددة ({selectedServiceIds.length})</span>
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setSelectionMode(false);
                      setSelectedServiceIds([]);
                    }}
                    className="h-9 w-9 rounded-xl hover:bg-muted"
                    title="إلغاء وضع التحديد (Esc)"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Batch Delete Confirmation Dialog */}
          <Dialog open={showBatchDeleteModal} onOpenChange={setShowBatchDeleteModal}>
            <DialogContent className="max-w-md p-6 rounded-3xl bg-card border-2 border-destructive/50 shadow-2xl text-right">
              <DialogHeader className="space-y-3">
                <DialogTitle className="text-xl font-black font-thamaniah text-destructive flex items-center gap-2">
                  <Trash2 className="w-5 h-5" />
                  <span>تأكيد حذف الخدمات المحددة</span>
                </DialogTitle>
                <DialogDescription className="text-sm font-semibold text-muted-foreground">
                  أنت على وشك حذف{" "}
                  <strong className="text-foreground">{selectedServiceIds.length}</strong> خدمة مع
                  كافة الحسابات وكلمات المرور والبيانات المحفوظة داخلها نهائياً. لا يمكن التراجع عن هذا الإجراء.
                </DialogDescription>
              </DialogHeader>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-border/60">
                <Button
                  variant="outline"
                  onClick={() => setShowBatchDeleteModal(false)}
                  className="h-10 px-4 rounded-xl font-bold"
                >
                  إلغاء
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirmBatchDelete}
                  className="h-10 px-5 rounded-xl font-bold gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>نعم، احذف الكل نهائياً</span>
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </ContextMenuTrigger>

      {/* Page Background Context Menu (Right click anywhere across full viewport / empty space) */}
      <ContextMenuContent className="w-60 rounded-2xl bg-card/95 backdrop-blur-md border border-border/80 shadow-2xl p-1.5 text-right font-medium text-sm">
        <ContextMenuItem
          onClick={() => {
            setAddServiceError(null);
            setShowAddService(true);
          }}
          className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2"
        >
          <span>إنشاء خدمة جديدة</span>
          <Plus className="w-4 h-4 text-white" />
        </ContextMenuItem>
        <ContextMenuSeparator className="my-1 bg-border/60" />
        <ContextMenuItem
          onClick={handleExportVault}
          disabled={isProcessingBackup}
          className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2"
        >
          <span>تصدير نسخة الخزنة (.dat)</span>
          <Download className="w-4 h-4 text-white" />
        </ContextMenuItem>
        <ContextMenuItem
          onClick={handleImportVault}
          disabled={isProcessingBackup}
          className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2"
        >
          <span>استيراد نسخة خزنة (.dat)</span>
          <Upload className="w-4 h-4 text-white" />
        </ContextMenuItem>
        <ContextMenuSeparator className="my-1 bg-border/60" />
        <ContextMenuItem
          onClick={() => setSelectionMode(true)}
          className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2"
        >
          <span>تحديد وحذف خدمات متعددة</span>
          <CheckSquare className="w-4 h-4 text-white" />
        </ContextMenuItem>
        <ContextMenuItem
          onClick={handleOpenVaultFolder}
          className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2"
        >
          <span>فتح مسار ملف الخزنة</span>
          <FolderOpen className="w-4 h-4 text-white" />
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )}

      {/* ================= MODAL: SERVICE DETAIL & ACCOUNTS ================= */}
      <Dialog
        open={Boolean(selectedService)}
        onOpenChange={(open) => !open && setSelectedServiceId(null)}
      >
        <DialogContent className="max-w-4xl p-8 rounded-3xl bg-card border-2 border-border/80 shadow-2xl max-h-[90vh] overflow-y-auto">
          {selectedService && (
            <div className="space-y-8">
              {/* Service Header Info */}
              <div className="flex items-center justify-between pb-6 border-b border-border/70">
                <div className="flex items-center gap-5">
                  {selectedService.icon_data ? (
                    <div className="w-20 h-20 rounded-2xl overflow-hidden p-2 bg-muted/50 border border-border/60 shadow-sm shrink-0">
                      <img
                        src={selectedService.icon_data}
                        alt={selectedService.name}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : (
                    <div
                      className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${getServiceGradient(
                        selectedService.name
                      )} flex items-center justify-center text-white text-3xl font-black font-thamaniah shadow-md shrink-0`}
                    >
                      {selectedService.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <h3 className="text-3xl font-black font-thamaniah text-foreground">
                      {selectedService.name}
                    </h3>
                    <p className="text-sm font-semibold text-muted-foreground mt-1">
                      {serviceAccounts.length} حساب مسجل
                    </p>
                  </div>
                </div>

                {/* Service Header Actions */}
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="default"
                    onClick={() => openEditServiceModal(selectedService)}
                    className="h-11 px-4 rounded-xl gap-2 font-bold border-border/80 shadow-sm"
                  >
                    <Pencil className="w-4 h-4 text-primary" />
                    <span>تعديل الخدمة والصورة</span>
                  </Button>
                  <Button
                    onClick={() => {
                      setAddAccountError(null);
                      const isCard = isBankOrCardService(selectedService?.name);
                      setAccountFormMode(isCard ? "card" : "login");
                      setAccLabel("");
                      setAccUsername("");
                      setAccEmail("");
                      setAccPassword("");
                      setAccRecoveryKey("");
                      setAccUrl("");
                      setAccNotes("");
                      setCardHolder("");
                      setCardNumber("");
                      setCardExpiry("");
                      setCardCvv("");
                      setCardPin("");
                      setShowAddAccount(true);
                    }}
                    className="h-11 px-5 rounded-xl gap-2 font-bold shadow-md"
                  >
                    <Plus className="w-5 h-5" />
                    <span>إضافة حساب</span>
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => setServiceToDelete(selectedService)}
                    className="h-11 w-11 rounded-xl shadow-sm"
                    title="حذف الخدمة بالكامل"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* Accounts List (Multi-Field with Dedicated One-Click Copy for Every Item) */}
              <div className="space-y-5 max-h-[60vh] overflow-y-auto px-1">
                {loadingAccounts ? (
                  <div className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                    <span>جاري تحميل بيانات الحسابات...</span>
                  </div>
                ) : serviceAccounts.length === 0 ? (
                  <div className="text-center py-14 space-y-4 bg-muted/20 rounded-2xl border-2 border-dashed border-border/60">
                    <p className="text-base font-semibold text-muted-foreground">
                      لا توجد حسابات مسجلة تحت هذه الخدمة حتى الآن.
                    </p>
                    <Button
                      onClick={() => {
                        setAddAccountError(null);
                        const isCard = isBankOrCardService(selectedService?.name);
                        setAccountFormMode(isCard ? "card" : "login");
                        setAccLabel("");
                        setAccUsername("");
                        setAccEmail("");
                        setAccPassword("");
                        setAccRecoveryKey("");
                        setAccUrl("");
                        setAccNotes("");
                        setCardHolder("");
                        setCardNumber("");
                        setCardExpiry("");
                        setCardCvv("");
                        setCardPin("");
                        setShowAddAccount(true);
                      }}
                      size="default"
                      className="h-12 px-6 rounded-xl gap-2 font-bold"
                    >
                      <Plus className="w-4 h-4" />
                      <span>إضافة أول حساب الآن</span>
                    </Button>
                  </div>
                ) : (
                  serviceAccounts.map((acc) => {
                    const isCard = isAccountCard(acc, selectedService?.name);

                    if (isCard) {
                      const brand = detectCardBrand(acc.username, selectedService?.name);
                      const pinMatch = acc.notes?.match(/PIN:\s*(\d{4,6})/i);
                      const cardPin = pinMatch ? pinMatch[1] : null;
                      const cleanNotes = acc.notes?.replace(/\[CARD\]/g, "").replace(/PIN:\s*\d{4,6}/gi, "").trim();
                      const isCvvRevealed = revealedCardCvvs[acc.id] || false;
                      const isPinRevealed = revealedCardPins[acc.id] || false;

                      return (
                        <div
                          key={acc.id}
                          className="relative rounded-3xl p-6 sm:p-7 shadow-xl border-2 border-border/80 overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white space-y-4"
                        >
                          {/* Ambient background glows */}
                          <div className="absolute top-0 right-0 w-80 h-80 bg-primary/20 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
                          <div className="absolute bottom-0 left-0 w-80 h-80 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none -ml-20 -mb-20" />

                          {/* Top Header: Chip, Contactless, Card Label, Network Badge & Actions */}
                          <div className="relative z-10 flex items-center justify-between border-b border-white/10 pb-4">
                            <div className="flex items-center gap-3">
                              {/* EMV Gold Chip Graphic */}
                              <div className="w-12 h-9 rounded-md bg-gradient-to-br from-amber-300 via-amber-400 to-yellow-600 p-0.5 shadow-inner border border-yellow-200/50 flex flex-col justify-between overflow-hidden shrink-0">
                                <div className="h-2 border-b border-amber-600/40 flex">
                                  <div className="w-1/2 border-r border-amber-600/40"></div>
                                </div>
                                <div className="h-2 border-b border-amber-600/40 flex">
                                  <div className="w-1/3 border-r border-amber-600/40"></div>
                                  <div className="w-1/3 border-r border-amber-600/40"></div>
                                </div>
                                <div className="h-2 flex">
                                  <div className="w-1/2 border-r border-amber-600/40"></div>
                                </div>
                              </div>
                              {/* Wireless Contactless Wave Icon */}
                              <svg className="w-5 h-5 text-slate-400 rotate-90 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M8.5 16.5a5 5 0 0 1 0-7" />
                                <path d="M12 19a8.5 8.5 0 0 1 0-12" />
                                <path d="M15.5 21.5a12 12 0 0 1 0-17" />
                              </svg>
                              <span className="text-xl font-bold font-thamaniah text-white pr-1 truncate">
                                {acc.label || "بطاقة دفع"}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <Badge className="px-3.5 py-1 text-xs font-black tracking-widest bg-white/10 text-white border border-white/20 backdrop-blur-md rounded-xl">
                                {brand.badge}
                              </Badge>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDuplicateAccount(acc)}
                                className="h-9 px-3 rounded-xl gap-1.5 text-xs font-bold bg-white/5 border-white/20 text-white hover:bg-white/15 transition-colors"
                                title="تكرار هذه البطاقة"
                              >
                                <CopyPlus className="w-3.5 h-3.5" />
                                <span>تكرار</span>
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openEditAccountModal(acc)}
                                className="h-9 px-3 rounded-xl gap-1.5 text-xs font-bold bg-white/5 border-white/20 text-white hover:bg-white/15"
                                title="تعديل بيانات البطاقة"
                              >
                                <Pencil className="w-3.5 h-3.5 text-primary" />
                                <span>تعديل</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  setAccountToDelete({
                                    serviceId: selectedService.id,
                                    accountId: acc.id,
                                    label: acc.label || acc.username || "هذه البطاقة",
                                  })
                                }
                                className="h-9 w-9 rounded-xl text-rose-400 hover:bg-rose-500/20"
                                title="حذف البطاقة"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>

                          {/* Card Number Section (Large, spaced 4-4-4-4) */}
                          <div className="relative z-10 my-4 bg-black/35 backdrop-blur-md p-4 rounded-2xl border border-white/10 flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <span className="text-[11px] uppercase tracking-wider text-slate-400 font-bold block mb-1">
                                رقم البطاقة (Card Number)
                              </span>
                              <div className="font-mono text-xl sm:text-2xl font-bold tracking-[0.25em] text-white">
                                {revealedAccountPasswords[acc.id] && acc.password
                                  ? acc.password.replace(/(.{4})/g, "$1 ").trim()
                                  : "•••• •••• •••• ••••"}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={() => toggleRevealAccountPassword(selectedService.id, acc)}
                                className="h-10 w-10 p-0 rounded-xl text-slate-400 hover:text-white hover:bg-white/10"
                                title={revealedAccountPasswords[acc.id] ? "إخفاء رقم البطاقة" : "إظهار رقم البطاقة"}
                              >
                                {revealedAccountPasswords[acc.id] ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </Button>
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => copyAccountPassword(selectedService.id, acc.id)}
                                className="h-10 px-4 rounded-xl font-bold text-xs gap-2 shadow-lg shrink-0"
                              >
                              {copiedKey === `${acc.id}_password` ? (
                                <>
                                  <Check className="w-4 h-4 text-emerald-300" />
                                  <span>تم نسخ الرقم!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-4 h-4" />
                                  <span>نسخ رقم البطاقة</span>
                                </>
                              )}
                            </Button>
                            </div>
                          </div>

                          {/* Bottom Info Grid: Cardholder, Expiry, CVV, PIN */}
                          <div className="relative z-10 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                            {/* Cardholder */}
                            <div className="bg-black/25 p-3 rounded-xl border border-white/10 flex items-center justify-between">
                              <div className="min-w-0 pr-1 flex-1">
                                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-0.5">
                                  حامل البطاقة
                                </span>
                                <span className="font-sans font-bold text-white tracking-wide block truncate uppercase">
                                  {acc.username || "—"}
                                </span>
                              </div>
                              {acc.username && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyFieldValue(acc.id, "holder", acc.username)}
                                  className="h-7 w-7 p-0 text-slate-400 hover:text-white shrink-0"
                                  title="نسخ اسم حامل البطاقة"
                                >
                                  {copiedKey === `${acc.id}_holder` ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </Button>
                              )}
                            </div>

                            {/* Expiry Date */}
                            <div className="bg-black/25 p-3 rounded-xl border border-white/10 flex items-center justify-between">
                              <div>
                                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-0.5">
                                  تنتهي في
                                </span>
                                <span className="font-mono font-bold text-white block">
                                  {acc.url || "MM/YY"}
                                </span>
                              </div>
                              {acc.url && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => copyFieldValue(acc.id, "url", acc.url)}
                                  className="h-7 w-7 p-0 text-slate-400 hover:text-white"
                                  title="نسخ تاريخ الانتهاء"
                                >
                                  {copiedKey === `${acc.id}_url` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                </Button>
                              )}
                            </div>

                            {/* CVV */}
                            <div className="bg-black/25 p-3 rounded-xl border border-white/10 flex items-center justify-between">
                              <div>
                                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-0.5">
                                  رمز الأمان CVV
                                </span>
                                <span className="font-mono font-bold text-amber-300 block">
                                  {isCvvRevealed ? acc.recovery_key : (acc.recovery_key ? "•••" : "—")}
                                </span>
                              </div>
                              {acc.recovery_key && (
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setRevealedCardCvvs(prev => ({ ...prev, [acc.id]: !prev[acc.id] }))}
                                    className="h-7 w-7 p-0 text-slate-400 hover:text-white"
                                    title={isCvvRevealed ? "إخفاء" : "إظهار"}
                                  >
                                    {isCvvRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => copyFieldValue(acc.id, "recovery_key", acc.recovery_key)}
                                    className="h-7 w-7 p-0 text-slate-400 hover:text-white"
                                    title="نسخ CVV"
                                  >
                                    {copiedKey === `${acc.id}_recovery_key` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                  </Button>
                                </div>
                              )}
                            </div>

                            {/* PIN */}
                            {cardPin ? (
                              <div className="bg-black/25 p-3 rounded-xl border border-white/10 flex items-center justify-between">
                                <div>
                                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-0.5">
                                    الرمز السري PIN
                                  </span>
                                  <span className="font-mono font-bold text-emerald-400 block">
                                    {isPinRevealed ? cardPin : "••••"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setRevealedCardPins(prev => ({ ...prev, [acc.id]: !prev[acc.id] }))}
                                    className="h-7 w-7 p-0 text-slate-400 hover:text-white"
                                    title={isPinRevealed ? "إخفاء" : "إظهار"}
                                  >
                                    {isPinRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => copyFieldValue(acc.id, "pin", cardPin)}
                                    className="h-7 w-7 p-0 text-slate-400 hover:text-white"
                                    title="نسخ PIN"
                                  >
                                    {copiedKey === `${acc.id}_pin` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="bg-black/25 p-3 rounded-xl border border-white/10">
                                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold block mb-0.5">
                                  حالة الحماية
                                </span>
                                <span className="font-sans font-bold text-emerald-400 text-xs block">
                                  ✓ مشفرة ومؤمنة
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Extra Notes */}
                          {cleanNotes && (
                            <div className="relative z-10 pt-3 border-t border-white/10 text-xs text-slate-300 flex items-center justify-between">
                              <span className="truncate pr-1"><strong className="text-slate-400">ملاحظات:</strong> {cleanNotes}</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyFieldValue(acc.id, "notes", cleanNotes)}
                                className="h-6 px-2 text-[11px] text-slate-400 hover:text-white shrink-0"
                              >
                                نسخ
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    }

                    return (
                    <div
                      key={acc.id}
                      className="p-6 rounded-2xl border-2 border-border/70 bg-card/90 shadow-sm space-y-4 hover:border-primary/50 transition-colors"
                    >
                      {/* Account Card Header */}
                      <div className="flex items-center justify-between border-b border-border/40 pb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-bold">
                            <KeyRound className="w-4 h-4" />
                          </div>
                          <span className="text-xl font-bold font-thamaniah text-foreground">
                            {acc.label || "الحساب الرئيسي"}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* Duplicate Account Button */}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDuplicateAccount(acc)}
                            className="h-9 px-3 rounded-xl gap-1.5 text-xs font-bold border-border/80 hover:bg-primary/10 hover:text-primary transition-colors"
                            title="تكرار هذا الحساب لإنشاء حساب مشابه بسهولة"
                          >
                            <CopyPlus className="w-3.5 h-3.5" />
                            <span>تكرار</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditAccountModal(acc)}
                            className="h-9 px-3 rounded-xl gap-1.5 text-xs font-bold border-border/80"
                            title="تعديل بيانات الحساب"
                          >
                            <Pencil className="w-3.5 h-3.5 text-primary" />
                            <span>تعديل</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setAccountToDelete({
                                serviceId: selectedService.id,
                                accountId: acc.id,
                                label: acc.label || acc.username || "هذا الحساب",
                              })
                            }
                            className="h-9 w-9 rounded-xl text-destructive hover:bg-destructive/15"
                            title="حذف الحساب"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Fields Grid */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {/* Username */}
                        {acc.username && (
                          <div className="flex items-center justify-between bg-muted/40 p-3.5 rounded-xl border border-border/50">
                            <div className="min-w-0 pr-1 flex-1">
                              <span className="text-xs font-bold text-muted-foreground block mb-0.5">
                                اسم المستخدم
                              </span>
                              <span className="font-sans font-bold text-base text-foreground truncate block select-all">
                                {acc.username}
                              </span>
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => copyFieldValue(acc.id, "username", acc.username)}
                              className="h-8 px-2.5 rounded-lg text-xs font-bold gap-1 shrink-0"
                            >
                              {copiedKey === `${acc.id}_username` ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>تم</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>نسخ</span>
                                </>
                              )}
                            </Button>
                          </div>
                        )}

                        {/* Email */}
                        {acc.email && (
                          <div className="flex items-center justify-between bg-muted/40 p-3.5 rounded-xl border border-border/50">
                            <div className="min-w-0 pr-1 flex-1">
                              <span className="text-xs font-bold text-muted-foreground block mb-0.5">
                                البريد الإلكتروني
                              </span>
                              <span className="font-sans font-bold text-base text-foreground truncate block select-all">
                                {acc.email}
                              </span>
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => copyFieldValue(acc.id, "email", acc.email)}
                              className="h-8 px-2.5 rounded-lg text-xs font-bold gap-1 shrink-0"
                            >
                              {copiedKey === `${acc.id}_email` ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>تم</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>نسخ</span>
                                </>
                              )}
                            </Button>
                          </div>
                        )}

                        {/* Password */}
                        {acc.has_password && (
                          <div className="flex items-center justify-between bg-muted/40 p-3.5 rounded-xl border border-border/50 md:col-span-2">
                            <div className="min-w-0 pr-1 flex-1">
                              <span className="text-xs font-bold text-muted-foreground block mb-0.5">
                                كلمة المرور
                              </span>
                              <span
                                className={`block font-bold select-all ${
                                  revealedAccountPasswords[acc.id]
                                    ? "font-mono text-base tracking-normal text-emerald-400"
                                    : "font-sans text-lg tracking-wider select-none text-muted-foreground"
                                }`}
                              >
                                {revealedAccountPasswords[acc.id]
                                  ? acc.password || "••••••••••••••••"
                                  : "••••••••••••••••"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={() => toggleRevealAccountPassword(selectedService.id, acc)}
                                className="h-9 w-9 p-0 rounded-lg text-muted-foreground hover:text-foreground"
                                title={
                                  revealedAccountPasswords[acc.id]
                                    ? "إخفاء كلمة المرور"
                                    : "إظهار كلمة المرور"
                                }
                              >
                                {revealedAccountPasswords[acc.id] ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </Button>
                              <Button
                                variant="default"
                                size="sm"
                                onClick={() => copyAccountPassword(selectedService.id, acc.id)}
                                className="h-9 px-3.5 rounded-lg text-xs font-bold gap-1.5 shadow-sm"
                              >
                                {copiedKey === `${acc.id}_password` ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>تم النسخ!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>نسخ كلمة المرور</span>
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Recovery Key */}
                        {acc.recovery_key && (
                          <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/30 p-3.5 rounded-xl md:col-span-2">
                            <div className="min-w-0 pr-1 flex-1">
                              <span className="text-xs font-bold text-amber-400 block mb-0.5">
                                مفتاح استرداد الحساب للطوارئ (Recovery Key)
                              </span>
                              <span
                                className={`block font-bold select-all ${
                                  revealedAccountRecoveryKeys[acc.id]
                                    ? "font-mono text-base text-amber-200 tracking-normal"
                                    : "font-sans text-lg text-amber-300/60 tracking-wider select-none"
                                }`}
                              >
                                {revealedAccountRecoveryKeys[acc.id]
                                  ? acc.recovery_key
                                  : "••••••••••••••••"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={() => toggleRevealAccountRecoveryKey(acc.id)}
                                className="h-8 w-8 p-0 rounded-lg text-amber-300 hover:text-amber-100 hover:bg-amber-500/20"
                                title={
                                  revealedAccountRecoveryKeys[acc.id]
                                    ? "إخفاء مفتاح الاسترداد"
                                    : "إظهار مفتاح الاسترداد"
                                }
                              >
                                {revealedAccountRecoveryKeys[acc.id] ? (
                                  <EyeOff className="w-4 h-4" />
                                ) : (
                                  <Eye className="w-4 h-4" />
                                )}
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => copyFieldValue(acc.id, "recovery_key", acc.recovery_key)}
                                className="h-8 px-3 rounded-lg text-xs font-bold gap-1.5 shrink-0 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40"
                              >
                                {copiedKey === `${acc.id}_recovery_key` ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>تم</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>نسخ المفتاح</span>
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* URL */}
                        {acc.url && (
                          <div className="flex items-center justify-between bg-muted/40 p-3.5 rounded-xl border border-border/50 md:col-span-2">
                            <div className="min-w-0 pr-1 flex-1">
                              <span className="text-xs font-bold text-muted-foreground block mb-0.5">
                                رابط تسجيل الدخول (URL)
                              </span>
                              <button
                                type="button"
                                onClick={() => handleOpenUrl(acc.url)}
                                className="text-primary hover:underline text-sm font-semibold truncate block text-right cursor-pointer bg-transparent border-0 p-0"
                                title="فتح الرابط في المتصفح الافتراضي"
                              >
                                {acc.url}
                              </button>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyFieldValue(acc.id, "url", acc.url)}
                                className="h-8 px-2.5 rounded-lg text-xs font-bold gap-1"
                              >
                                {copiedKey === `${acc.id}_url` ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>تم</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>نسخ</span>
                                  </>
                                )}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenUrl(acc.url)}
                                className="h-8 w-8 p-0 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 cursor-pointer"
                                title="فتح الرابط في المتصفح الافتراضي"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Notes */}
                        {acc.notes && (
                          <div className="bg-muted/40 p-3.5 rounded-xl border border-border/50 md:col-span-2 flex items-start justify-between gap-3">
                            <div className="min-w-0 pr-1 flex-1">
                              <span className="text-xs font-bold text-muted-foreground block mb-1">
                                ملاحظات
                              </span>
                              <p className="text-sm font-medium text-foreground/90 whitespace-pre-wrap leading-relaxed select-all">
                                {acc.notes}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyFieldValue(acc.id, "notes", acc.notes)}
                              className="h-8 px-2.5 rounded-lg text-xs font-bold gap-1 shrink-0"
                            >
                              {copiedKey === `${acc.id}_notes` ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>تم</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>نسخ</span>
                                </>
                              )}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ================= MODAL: ADD SERVICE ================= */}
      <Dialog open={showAddService} onOpenChange={setShowAddService}>
        <DialogContent className="max-w-5xl w-[94vw] p-8 rounded-3xl bg-card border-2 border-border/80 shadow-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-3xl font-black font-thamaniah flex items-center gap-3">
              <Plus className="w-7 h-7 text-primary" />
              <span>إضافة تطبيق أو موقع جديد</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              إضافة تطبيق أو موقع جديد
            </DialogDescription>
          </DialogHeader>

          {/* Prominent in-modal error box */}
          {addServiceError && (
            <div className="p-4 rounded-2xl bg-destructive/15 border border-destructive/30 text-destructive-foreground flex items-center justify-between text-base font-bold">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <span>{addServiceError}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAddServiceError(null)}
                className="h-7 w-7 p-0"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          <form onSubmit={handleAddService} className="space-y-6 pt-2">
            {/* Quick Presets Section */}
            <div className="space-y-3 p-4 rounded-2xl bg-muted/30 border border-border/60">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-foreground">
                  اختر من التطبيقات والمواقع الشائعة ({POPULAR_SERVICES.length} خدمة جاهزة):
                </label>
                <div className="flex items-center gap-1 bg-card/80 p-1 rounded-xl border border-border/60">
                  <button
                    type="button"
                    onClick={() => setPresetViewMode("grid")}
                    className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                      presetViewMode === "grid"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title="عرض الشبكة (4 أعمدة)"
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresetViewMode("list")}
                    className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                      presetViewMode === "list"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title="عرض القائمة (List)"
                  >
                    <List className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Search & Categories Filter */}
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="ابحث بالاسم العربي أو الإنجليزي (مثل: Steam, Disney, Claude...)"
                    value={presetSearch}
                    onChange={(e) => setPresetSearch(e.target.value)}
                    className="h-9 text-xs pr-8 pl-3 rounded-xl bg-card/80 border-border/70"
                  />
                  {presetSearch && (
                    <button
                      type="button"
                      onClick={() => setPresetSearch("")}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-sm font-bold"
                    >
                      ×
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
                  {[
                    { id: "all", label: "الكل" },
                    { id: "finance", label: "بنوك وبطاقات" },
                    { id: "work", label: "تسوق وحكومي وعمل" },
                    { id: "social", label: "تواصل" },
                    { id: "entertainment", label: "ترفيه" },
                    { id: "gaming", label: "ألعاب" },
                    { id: "tech", label: "تقنية" },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setPresetCategory(cat.id)}
                      className={`px-3 py-1.5 rounded-xl font-bold shrink-0 transition-all ${
                        presetCategory === cat.id
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-card hover:bg-muted text-muted-foreground hover:text-foreground border border-border/50"
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Presets: Grid (4 columns) or List view */}
              {presetViewMode === "grid" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5 max-h-64 overflow-y-auto p-2.5 rounded-xl bg-card/40 border border-border/40 scrollbar-thin">
                  {filteredPresets.map((preset) => {
                    const isSelected = newServiceName.toLowerCase() === preset.name.toLowerCase();
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={async () => {
                          setNewServiceName(preset.name);
                          setNewServiceIcon(generateCinematicCoverSvg(preset));
                          setAddServiceError(null);
                          const cover = await getServiceCoverAsync(preset.id);
                          if (cover) setNewServiceIcon(cover);
                        }}
                        className={`h-12 flex items-center gap-3 px-4 rounded-xl text-sm font-bold transition-all border text-right cursor-pointer ${
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary shadow-sm"
                            : "bg-card hover:bg-muted/80 border-border/60 text-foreground hover:border-primary/50"
                        }`}
                        title={`${preset.name} (${preset.arabicName})`}
                      >
                        <span
                          className="w-4 h-4 rounded-full inline-block shrink-0 shadow-sm"
                          style={{ backgroundColor: preset.brandColor }}
                        />
                        <span className="truncate">{preset.name}</span>
                      </button>
                    );
                  })}
                  {filteredPresets.length === 0 && (
                    <div className="col-span-full py-8 text-center text-xs text-muted-foreground">
                      لم يتم العثور على خدمة تطابق بحثك. يمكنك كتابة الاسم الذي تريده في الحقل أدناه!
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2.5 max-h-64 overflow-y-auto p-2.5 rounded-xl bg-card/40 border border-border/40 scrollbar-thin">
                  {filteredPresets.map((preset) => {
                    const isSelected = newServiceName.toLowerCase() === preset.name.toLowerCase();
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={async () => {
                          setNewServiceName(preset.name);
                          setNewServiceIcon(generateCinematicCoverSvg(preset));
                          setAddServiceError(null);
                          const cover = await getServiceCoverAsync(preset.id);
                          if (cover) setNewServiceIcon(cover);
                        }}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold transition-all border cursor-pointer ${
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary shadow-sm"
                            : "bg-card hover:bg-muted/80 border-border/60 text-foreground hover:border-primary/50"
                        }`}
                        title={`${preset.name} (${preset.arabicName})`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className="w-4 h-4 rounded-full inline-block shrink-0 shadow-sm"
                            style={{ backgroundColor: preset.brandColor }}
                          />
                          <span className="truncate font-bold text-sm">{preset.name}</span>
                        </div>
                        <span
                          className={`text-xs px-2.5 py-1 rounded-lg border font-medium shrink-0 ${
                            isSelected
                              ? "bg-primary-foreground/20 text-primary-foreground border-transparent"
                              : "bg-muted/70 text-muted-foreground border-border/50"
                          }`}
                        >
                          {PRESET_CATEGORY_LABELS[preset.category] || preset.category}
                        </span>
                      </button>
                    );
                  })}
                  {filteredPresets.length === 0 && (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                      لم يتم العثور على خدمة تطابق بحثك. يمكنك كتابة الاسم الذي تريده في الحقل أدناه!
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-base font-bold text-foreground mb-2">اسم الخدمة *</label>
              <Input
                placeholder="مثال: Google, Netflix, Steam, منصة أبشر..."
                value={newServiceName}
                onChange={(e) => setNewServiceName(e.target.value)}
                className="h-14 text-lg px-4 font-sans font-bold rounded-xl border-2"
                autoFocus
                required
              />
            </div>

            <div>
              <label className="block text-base font-bold text-foreground mb-2">
                غلاف أو صورة الخدمة (يتم اختياره تلقائياً من القائمة أعلاه أو رفعه يدوياً):
              </label>

              {newServiceIcon ? (
                <div className="space-y-3">
                  <div className="relative rounded-2xl overflow-hidden border-2 border-primary/50 aspect-video max-w-sm mx-auto shadow-2xl bg-zinc-950 flex items-center justify-center">
                    <img
                      src={newServiceIcon}
                      alt=""
                      aria-hidden="true"
                      className="absolute inset-0 w-full h-full object-cover blur-2xl opacity-40 scale-125 pointer-events-none"
                    />
                    <img
                      src={newServiceIcon}
                      alt="معاينة الغلاف"
                      className="relative z-0 w-full h-full object-contain p-3 drop-shadow-md"
                    />
                    <div className="absolute top-2 left-2 flex gap-2">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => setNewServiceIcon(null)}
                        className="h-8 px-3 rounded-xl text-xs font-bold gap-1 shadow-md"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>إزالة الغلاف</span>
                      </Button>
                    </div>
                  </div>

                  <div className="text-center">
                    <label className="text-xs font-bold text-muted-foreground hover:text-primary cursor-pointer transition-colors inline-flex items-center gap-1.5">
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>أو اختر صورة أخرى مخصصة من جهازك</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => onImageFileSelected(e, setNewServiceIcon, setAddServiceError)}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => onImageFileSelected(e, setNewServiceIcon, setAddServiceError)}
                    className="h-14 text-sm file:h-full file:bg-secondary file:text-secondary-foreground file:border-0 file:px-4 file:rounded-lg file:mr-2 cursor-pointer border-2 rounded-xl pt-3"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border/40">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddService(false)}
                className="h-13 px-6 rounded-xl text-base font-bold"
              >
                إلغاء
              </Button>
              <Button type="submit" className="h-13 px-8 rounded-xl text-base font-bold shadow-lg">
                حفظ الخدمة
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ================= MODAL: EDIT SERVICE (NAME & ICON) ================= */}
      <Dialog open={showEditService} onOpenChange={setShowEditService}>
        <DialogContent className="max-w-5xl w-[94vw] p-8 rounded-3xl bg-card border-2 border-border/80 shadow-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-3xl font-black font-thamaniah flex items-center gap-3">
              <Pencil className="w-7 h-7 text-primary" />
              <span>تعديل بيانات وأيقونة الخدمة</span>
            </DialogTitle>
            <DialogDescription className="text-base text-muted-foreground pt-1">
              يمكنك تغيير اسم الخدمة أو تحديث صورتها أو حذفها.
            </DialogDescription>
          </DialogHeader>

          {/* Prominent in-modal error box */}
          {editServiceError && (
            <div className="p-4 rounded-2xl bg-destructive/15 border border-destructive/30 text-destructive-foreground flex items-center justify-between text-base font-bold">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <span>{editServiceError}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditServiceError(null)}
                className="h-7 w-7 p-0"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          <form onSubmit={handleUpdateService} className="space-y-6 pt-2">
            {/* Quick Presets Section */}
            <div className="space-y-3 p-4 rounded-2xl bg-muted/30 border border-border/60">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-foreground">
                  أو اختر تطبيقاً / شعاراً جاهزاً ({POPULAR_SERVICES.length} خدمة):
                </label>
                <div className="flex items-center gap-1 bg-card/80 p-1 rounded-xl border border-border/60">
                  <button
                    type="button"
                    onClick={() => setPresetViewMode("grid")}
                    className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                      presetViewMode === "grid"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title="عرض الشبكة (4 أعمدة)"
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresetViewMode("list")}
                    className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                      presetViewMode === "list"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    title="عرض القائمة (List)"
                  >
                    <List className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Search & Categories Filter */}
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="ابحث بالاسم العربي أو الإنجليزي (مثل: Steam, Disney, Claude...)"
                    value={presetSearch}
                    onChange={(e) => setPresetSearch(e.target.value)}
                    className="h-9 text-xs pr-8 pl-3 rounded-xl bg-card/80 border-border/70"
                  />
                  {presetSearch && (
                    <button
                      type="button"
                      onClick={() => setPresetSearch("")}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-sm font-bold"
                    >
                      ×
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
                  {[
                    { id: "all", label: "الكل" },
                    { id: "finance", label: "بنوك وبطاقات" },
                    { id: "work", label: "تسوق وحكومي وعمل" },
                    { id: "social", label: "تواصل" },
                    { id: "entertainment", label: "ترفيه" },
                    { id: "gaming", label: "ألعاب" },
                    { id: "tech", label: "تقنية" },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setPresetCategory(cat.id)}
                      className={`px-3 py-1.5 rounded-xl font-bold shrink-0 transition-all ${
                        presetCategory === cat.id
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "bg-card hover:bg-muted text-muted-foreground hover:text-foreground border border-border/50"
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Presets: Grid (4 columns) or List view */}
              {presetViewMode === "grid" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5 max-h-64 overflow-y-auto p-2.5 rounded-xl bg-card/40 border border-border/40 scrollbar-thin">
                  {filteredPresets.map((preset) => {
                    const isSelected = editServiceName.toLowerCase() === preset.name.toLowerCase();
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={async () => {
                          setEditServiceName(preset.name);
                          setEditServiceIcon(generateCinematicCoverSvg(preset));
                          setEditServiceError(null);
                          const cover = await getServiceCoverAsync(preset.id);
                          if (cover) setEditServiceIcon(cover);
                        }}
                        className={`h-12 flex items-center gap-3 px-4 rounded-xl text-sm font-bold transition-all border text-right cursor-pointer ${
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary shadow-sm"
                            : "bg-card hover:bg-muted/80 border-border/60 text-foreground hover:border-primary/50"
                        }`}
                        title={`${preset.name} (${preset.arabicName})`}
                      >
                        <span
                          className="w-4 h-4 rounded-full inline-block shrink-0 shadow-sm"
                          style={{ backgroundColor: preset.brandColor }}
                        />
                        <span className="truncate">{preset.name}</span>
                      </button>
                    );
                  })}
                  {filteredPresets.length === 0 && (
                    <div className="col-span-full py-8 text-center text-xs text-muted-foreground">
                      لم يتم العثور على خدمة تطابق بحثك.
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-2.5 max-h-64 overflow-y-auto p-2.5 rounded-xl bg-card/40 border border-border/40 scrollbar-thin">
                  {filteredPresets.map((preset) => {
                    const isSelected = editServiceName.toLowerCase() === preset.name.toLowerCase();
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={async () => {
                          setEditServiceName(preset.name);
                          setEditServiceIcon(generateCinematicCoverSvg(preset));
                          setEditServiceError(null);
                          const cover = await getServiceCoverAsync(preset.id);
                          if (cover) setEditServiceIcon(cover);
                        }}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-bold transition-all border cursor-pointer ${
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary shadow-sm"
                            : "bg-card hover:bg-muted/80 border-border/60 text-foreground hover:border-primary/50"
                        }`}
                        title={`${preset.name} (${preset.arabicName})`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className="w-4 h-4 rounded-full inline-block shrink-0 shadow-sm"
                            style={{ backgroundColor: preset.brandColor }}
                          />
                          <span className="truncate font-bold text-sm">{preset.name}</span>
                        </div>
                        <span
                          className={`text-xs px-2.5 py-1 rounded-lg border font-medium shrink-0 ${
                            isSelected
                              ? "bg-primary-foreground/20 text-primary-foreground border-transparent"
                              : "bg-muted/70 text-muted-foreground border-border/50"
                          }`}
                        >
                          {PRESET_CATEGORY_LABELS[preset.category] || preset.category}
                        </span>
                      </button>
                    );
                  })}
                  {filteredPresets.length === 0 && (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                      لم يتم العثور على خدمة تطابق بحثك.
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-base font-bold text-foreground mb-2">اسم الخدمة *</label>
              <Input
                value={editServiceName}
                onChange={(e) => setEditServiceName(e.target.value)}
                className="h-14 text-lg px-4 font-sans font-bold rounded-xl border-2"
                required
              />
            </div>

            <div>
              <label className="block text-base font-bold text-foreground mb-2">
                صورة أو غلاف الخدمة
              </label>

              {editServiceIcon ? (
                <div className="space-y-3">
                  <div className="relative rounded-2xl overflow-hidden border-2 border-primary/50 aspect-video max-w-sm mx-auto shadow-2xl bg-zinc-950 flex items-center justify-center">
                    <img
                      src={editServiceIcon}
                      alt=""
                      aria-hidden="true"
                      className="absolute inset-0 w-full h-full object-cover blur-2xl opacity-40 scale-125 pointer-events-none"
                    />
                    <img
                      src={editServiceIcon}
                      alt="معاينة الغلاف"
                      className="relative z-0 w-full h-full object-contain p-3 drop-shadow-md"
                    />
                    <div className="absolute top-2 left-2 flex gap-2">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => setEditServiceIcon(null)}
                        className="h-8 px-3 rounded-xl text-xs font-bold gap-1 shadow-md"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>إزالة الغلاف</span>
                      </Button>
                    </div>
                  </div>

                  <div className="text-center">
                    <label className="text-xs font-bold text-muted-foreground hover:text-primary cursor-pointer transition-colors inline-flex items-center gap-1.5">
                      <ImageIcon className="w-3.5 h-3.5" />
                      <span>تغيير الغلاف واختيار صورة من جهازك</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => onImageFileSelected(e, setEditServiceIcon, setEditServiceError)}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) => onImageFileSelected(e, setEditServiceIcon, setEditServiceError)}
                    className="h-14 text-sm file:h-full file:bg-secondary file:text-secondary-foreground file:border-0 file:px-4 file:rounded-lg file:mr-2 cursor-pointer border-2 rounded-xl pt-3"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border/40">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowEditService(false)}
                className="h-13 px-6 rounded-xl text-base font-bold"
              >
                إلغاء
              </Button>
              <Button type="submit" className="h-13 px-8 rounded-xl text-base font-bold shadow-lg">
                حفظ التعديلات
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ================= MODAL: ADD ACCOUNT (MULTI-FIELD ALL OPTIONAL) ================= */}
      <Dialog open={showAddAccount} onOpenChange={setShowAddAccount}>
        <DialogContent className="max-w-2xl p-8 rounded-3xl bg-card border-2 border-border/80 shadow-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-3xl font-black font-thamaniah flex items-center gap-3">
              <Plus className="w-7 h-7 text-primary" />
              <span>{accountFormMode === "card" ? `إضافة بطاقة جديدة إلى ${selectedService?.name}` : `إضافة حساب جديد إلى ${selectedService?.name}`}</span>
            </DialogTitle>
            <DialogDescription className="text-base text-muted-foreground pt-1">
              {accountFormMode === "card"
                ? "قالب بطاقات بنكية مخصص: املأ بيانات البطاقة لتشفيرها وحفظها بأمان فائق."
                : "جميع الخانات اختيارية ويمكنك ملء البيانات التي ترغب بحفظها."}
            </DialogDescription>
          </DialogHeader>

          {/* Mode Switcher: Login Account vs Bank Card */}
          <div className="flex p-1 bg-muted/60 rounded-2xl border border-border/60 mt-3 mb-2">
            <button
              type="button"
              onClick={() => setAccountFormMode("login")}
              className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
                accountFormMode === "login"
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <User className="w-4 h-4" />
              <span>حساب تسجيل دخول</span>
            </button>
            <button
              type="button"
              onClick={() => setAccountFormMode("card")}
              className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
                accountFormMode === "card"
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CreditCard className="w-4 h-4" />
              <span>بطاقة بنكية / دفع</span>
            </button>
          </div>

          {/* Prominent in-modal error box */}
          {addAccountError && (
            <div className="p-4 rounded-2xl bg-destructive/15 border border-destructive/30 text-destructive-foreground flex items-center justify-between text-base font-bold">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <span>{addAccountError}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAddAccountError(null)}
                className="h-7 w-7 p-0"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          <form onSubmit={handleAddAccount} className="space-y-4 pt-2">
            {accountFormMode === "card" ? (
              <div className="space-y-4">
                {/* Live Realistic Card Preview */}
                <div className="relative rounded-2xl p-5 sm:p-6 shadow-xl border border-white/10 overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white max-w-md mx-auto">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-7 rounded bg-gradient-to-br from-amber-300 to-yellow-600 p-0.5 border border-yellow-200/50 shadow-inner flex flex-col justify-between">
                        <div className="h-1.5 border-b border-amber-600/40"></div>
                        <div className="h-1.5 border-b border-amber-600/40"></div>
                      </div>
                      <span className="text-xs font-bold text-slate-300">
                        {accLabel || "بطاقة دفع"}
                      </span>
                    </div>
                    <Badge className="px-2.5 py-0.5 text-[10px] font-black tracking-wider bg-white/10 text-white border border-white/20">
                      {detectCardBrand(cardNumber, selectedService?.name).badge}
                    </Badge>
                  </div>

                  <div className="my-4 font-mono text-lg sm:text-xl font-bold tracking-[0.2em] text-center text-white/90 select-none">
                    {cardNumber ? cardNumber : "•••• •••• •••• ••••"}
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-300 pt-2 border-t border-white/10">
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-bold">حامل البطاقة</span>
                      <span className="font-bold tracking-wide uppercase text-white truncate max-w-[160px] block">
                        {cardHolder || "CARDHOLDER NAME"}
                      </span>
                    </div>
                    <div className="text-left">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-bold">تنتهي في</span>
                      <span className="font-mono font-bold text-white block">
                        {cardExpiry || "MM/YY"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Dedicated Bank Card Form Fields */}
                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">
                    تسمية البطاقة (اختياري)
                  </label>
                  <Input
                    placeholder="مثال: بطاقة الراتب، فيزا المشتريات، بطاقة السفر..."
                    value={accLabel}
                    onChange={(e) => setAccLabel(e.target.value)}
                    className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2"
                  />
                </div>

                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">
                    اسم حامل البطاقة (Cardholder Name)
                  </label>
                  <Input
                    placeholder="الاسم كما هو مطبوع على البطاقة بالإنجليزية (e.g. MOHAMMED AL-OTAIBI)"
                    value={cardHolder}
                    onChange={(e) => setCardHolder(e.target.value.toUpperCase())}
                    className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2 uppercase"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-base font-bold text-foreground">
                      رقم البطاقة (16 رقماً) *
                    </label>
                    <span className="text-xs font-bold text-primary">
                      {detectCardBrand(cardNumber, selectedService?.name).badge}
                    </span>
                  </div>
                  <div className="relative">
                    <Input
                      type={showCardNumber ? "text" : "password"}
                      placeholder="0000 0000 0000 0000"
                      value={cardNumber}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, "").slice(0, 16);
                        const formatted = raw.replace(/(\d{4})(?=\d)/g, "$1 ");
                        setCardNumber(formatted);
                      }}
                      className="h-13 text-lg px-4 font-mono font-bold rounded-xl border-2 tracking-widest pl-12"
                      required
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowCardNumber(!showCardNumber)}
                      className="absolute left-2 top-2.5 h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    >
                      {showCardNumber ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-base font-bold text-foreground mb-1.5">
                      تاريخ الانتهاء (MM/YY)
                    </label>
                    <Input
                      placeholder="08/29"
                      value={cardExpiry}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, "").slice(0, 4);
                        const formatted = raw.length >= 3 ? `${raw.slice(0, 2)}/${raw.slice(2)}` : raw;
                        setCardExpiry(formatted);
                      }}
                      className="h-13 text-base px-4 font-mono font-bold rounded-xl border-2 text-center"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-base font-bold text-foreground">
                        رمز الأمان (CVV / CVC)
                      </label>
                      <span className="text-xs text-muted-foreground">3 أو 4 أرقام</span>
                    </div>
                    <div className="relative">
                      <Input
                        type={showCardCvv ? "text" : "password"}
                        placeholder="123"
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                        className="h-13 text-base px-4 font-mono font-bold rounded-xl border-2 text-center tracking-widest pl-12"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowCardCvv(!showCardCvv)}
                        className="absolute left-2 top-2.5 h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                      >
                        {showCardCvv ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">
                    الرمز السري للبطاقة (PIN - اختياري)
                  </label>
                  <Input
                    type="password"
                    placeholder="رمز الصراف المكون من 4 أرقام"
                    value={cardPin}
                    onChange={(e) => setCardPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="h-13 text-base px-4 font-mono font-bold rounded-xl border-2 text-center tracking-widest"
                  />
                </div>

                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">
                    ملاحظات إضافية (اختياري)
                  </label>
                  <Input
                    placeholder="ملاحظات أو تعليمات خاصة بالبطاقة..."
                    value={accNotes}
                    onChange={(e) => setAccNotes(e.target.value)}
                    className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">
                    تسمية الحساب (اختياري)
                  </label>
                  <Input
                    placeholder="مثال: الحساب الشخصي، العمل، حساب الألعاب..."
                    value={accLabel}
                    onChange={(e) => setAccLabel(e.target.value)}
                    className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-base font-bold text-foreground mb-1.5">
                      اسم المستخدم (Username اختياري)
                    </label>
                    <Input
                      placeholder="اسم المستخدم في الخدمة"
                      value={accUsername}
                      onChange={(e) => setAccUsername(e.target.value)}
                      className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2"
                    />
                  </div>

                  <div>
                    <label className="block text-base font-bold text-foreground mb-1.5">
                      البريد الإلكتروني (Email اختياري)
                    </label>
                    <Input
                      type="email"
                      placeholder="user@example.com"
                      value={accEmail}
                      onChange={(e) => setAccEmail(e.target.value)}
                      className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-base font-bold text-foreground">كلمة المرور (اختياري)</label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleGeneratePassword("add")}
                      className="h-9 px-3 text-xs font-bold gap-1.5 rounded-lg border-primary/50 text-primary hover:bg-primary/10"
                    >
                      <Dices className="w-4 h-4" />
                      <span>توليد كلمة مرور قوية</span>
                    </Button>
                  </div>
                  <div className="relative">
                    <Input
                      type={showAccPassword ? "text" : "password"}
                      placeholder="كلمة المرور المشفرة"
                      value={accPassword}
                      onChange={(e) => setAccPassword(e.target.value)}
                      className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2 pl-12"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowAccPassword(!showAccPassword)}
                      className="absolute left-2 top-2.5 h-8 w-8 text-muted-foreground hover:text-foreground"
                      title={showAccPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                    >
                      {showAccPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">
                    مفتاح استرداد الحساب (Recovery Key اختياري)
                  </label>
                  <div className="relative">
                    <Input
                      type={showAccRecoveryKey ? "text" : "password"}
                      placeholder="مفتاح استرجاع الحساب الذي يقدمه الموقع للطوارئ"
                      value={accRecoveryKey}
                      onChange={(e) => setAccRecoveryKey(e.target.value)}
                      className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2 pl-12"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowAccRecoveryKey(!showAccRecoveryKey)}
                      className="absolute left-2 top-2.5 h-8 w-8 text-muted-foreground hover:text-foreground"
                      title={showAccRecoveryKey ? "إخفاء مفتاح الاسترداد" : "إظهار مفتاح الاسترداد"}
                    >
                      {showAccRecoveryKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">
                    رابط تسجيل الدخول (URL اختياري)
                  </label>
                  <Input
                    placeholder="https://example.com/login"
                    value={accUrl}
                    onChange={(e) => setAccUrl(e.target.value)}
                    className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2"
                  />
                </div>

                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">
                    ملاحظات إضافية (اختياري)
                  </label>
                  <Input
                    placeholder="ملاحظات سرية إضافية..."
                    value={accNotes}
                    onChange={(e) => setAccNotes(e.target.value)}
                    className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-border/40">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowAddAccount(false)}
                className="h-13 px-6 rounded-xl text-base font-bold"
              >
                إلغاء
              </Button>
              <Button type="submit" className="h-13 px-8 rounded-xl text-base font-bold shadow-lg">
                حفظ الحساب
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ================= MODAL: EDIT ACCOUNT ================= */}
      <Dialog
        open={Boolean(editingAccount)}
        onOpenChange={(open) => !open && setEditingAccount(null)}
      >
        <DialogContent className="max-w-2xl p-8 rounded-3xl bg-card border-2 border-border/80 shadow-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-3xl font-black font-thamaniah flex items-center gap-3">
              <Pencil className="w-7 h-7 text-primary" />
              <span>{accountFormMode === "card" ? "تعديل بيانات البطاقة" : "تعديل الحساب"}</span>
            </DialogTitle>
            <DialogDescription className="text-base text-muted-foreground pt-1">
              {accountFormMode === "card"
                ? "تعديل بيانات البطاقة البنكية المشفرة."
                : "تعديل بيانات حساب تسجيل الدخول."}
            </DialogDescription>
          </DialogHeader>

          {/* Mode Switcher: Login Account vs Bank Card */}
          <div className="flex p-1 bg-muted/60 rounded-2xl border border-border/60 mt-3 mb-2">
            <button
              type="button"
              onClick={() => setAccountFormMode("login")}
              className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
                accountFormMode === "login"
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <User className="w-4 h-4" />
              <span>حساب تسجيل دخول</span>
            </button>
            <button
              type="button"
              onClick={() => setAccountFormMode("card")}
              className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer ${
                accountFormMode === "card"
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CreditCard className="w-4 h-4" />
              <span>بطاقة بنكية / دفع</span>
            </button>
          </div>

          {/* Prominent in-modal error box */}
          {editAccountError && (
            <div className="p-4 rounded-2xl bg-destructive/15 border border-destructive/30 text-destructive-foreground flex items-center justify-between text-base font-bold">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-5 h-5 shrink-0" />
                <span>{editAccountError}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditAccountError(null)}
                className="h-7 w-7 p-0"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          <form onSubmit={handleUpdateAccount} className="space-y-4 pt-2">
            {accountFormMode === "card" ? (
              <div className="space-y-4">
                {/* Live Card Preview */}
                <div className="relative rounded-2xl p-5 sm:p-6 shadow-xl border border-white/10 overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white max-w-md mx-auto">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-7 rounded bg-gradient-to-br from-amber-300 to-yellow-600 p-0.5 border border-yellow-200/50 shadow-inner flex flex-col justify-between">
                        <div className="h-1.5 border-b border-amber-600/40"></div>
                        <div className="h-1.5 border-b border-amber-600/40"></div>
                      </div>
                      <span className="text-xs font-bold text-slate-300">
                        {editLabel || "بطاقة دفع"}
                      </span>
                    </div>
                    <Badge className="px-2.5 py-0.5 text-[10px] font-black tracking-wider bg-white/10 text-white border border-white/20">
                      {detectCardBrand(cardNumber, selectedService?.name).badge}
                    </Badge>
                  </div>

                  <div className="my-4 font-mono text-lg sm:text-xl font-bold tracking-[0.2em] text-center text-white/90 select-none">
                    {cardNumber ? cardNumber : "•••• •••• •••• ••••"}
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-300 pt-2 border-t border-white/10">
                    <div>
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-bold">حامل البطاقة</span>
                      <span className="font-bold tracking-wide uppercase text-white truncate max-w-[160px] block">
                        {cardHolder || "CARDHOLDER NAME"}
                      </span>
                    </div>
                    <div className="text-left">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 block font-bold">تنتهي في</span>
                      <span className="font-mono font-bold text-white block">
                        {cardExpiry || "MM/YY"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Dedicated Bank Card Form Fields */}
                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">
                    تسمية البطاقة (اختياري)
                  </label>
                  <Input
                    placeholder="مثال: بطاقة الراتب، فيزا المشتريات، بطاقة السفر..."
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2"
                  />
                </div>

                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">
                    اسم حامل البطاقة (Cardholder Name)
                  </label>
                  <Input
                    placeholder="الاسم كما هو مطبوع على البطاقة بالإنجليزية"
                    value={cardHolder}
                    onChange={(e) => setCardHolder(e.target.value.toUpperCase())}
                    className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2 uppercase"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-base font-bold text-foreground">
                      رقم البطاقة الجديد (16 رقماً - اختياري)
                    </label>
                    <span className="text-xs font-bold text-primary">
                      {detectCardBrand(cardNumber, selectedService?.name).badge}
                    </span>
                  </div>
                  <div className="relative">
                    <Input
                      type={showCardNumber ? "text" : "password"}
                      placeholder="اتركه فارغاً للإبقاء على رقم البطاقة الحالي"
                      value={cardNumber}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, "").slice(0, 16);
                        const formatted = raw.replace(/(\d{4})(?=\d)/g, "$1 ");
                        setCardNumber(formatted);
                      }}
                      className="h-13 text-lg px-4 font-mono font-bold rounded-xl border-2 tracking-widest pl-12"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowCardNumber(!showCardNumber)}
                      className="absolute left-2 top-2.5 h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    >
                      {showCardNumber ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-base font-bold text-foreground mb-1.5">
                      تاريخ الانتهاء (MM/YY)
                    </label>
                    <Input
                      placeholder="08/29"
                      value={cardExpiry}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, "").slice(0, 4);
                        const formatted = raw.length >= 3 ? `${raw.slice(0, 2)}/${raw.slice(2)}` : raw;
                        setCardExpiry(formatted);
                      }}
                      className="h-13 text-base px-4 font-mono font-bold rounded-xl border-2 text-center"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1.5">
                      <label className="text-base font-bold text-foreground">
                        رمز الأمان (CVV / CVC)
                      </label>
                      <span className="text-xs text-muted-foreground">3 أو 4 أرقام</span>
                    </div>
                    <div className="relative">
                      <Input
                        type={showCardCvv ? "text" : "password"}
                        placeholder="123"
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
                        className="h-13 text-base px-4 font-mono font-bold rounded-xl border-2 text-center tracking-widest pl-12"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowCardCvv(!showCardCvv)}
                        className="absolute left-2 top-2.5 h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                      >
                        {showCardCvv ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">
                    الرمز السري للبطاقة (PIN - اختياري)
                  </label>
                  <Input
                    type="password"
                    placeholder="رمز الصراف المكون من 4 أرقام"
                    value={cardPin}
                    onChange={(e) => setCardPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="h-13 text-base px-4 font-mono font-bold rounded-xl border-2 text-center tracking-widest"
                  />
                </div>

                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">
                    ملاحظات إضافية (اختياري)
                  </label>
                  <Input
                    placeholder="ملاحظات أو تعليمات خاصة بالبطاقة..."
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">
                    تسمية الحساب
                  </label>
                  <Input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-base font-bold text-foreground mb-1.5">
                      اسم المستخدم
                    </label>
                    <Input
                      value={editUsername}
                      onChange={(e) => setEditUsername(e.target.value)}
                      className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2"
                    />
                  </div>

                  <div>
                    <label className="block text-base font-bold text-foreground mb-1.5">
                      البريد الإلكتروني
                    </label>
                    <Input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-base font-bold text-foreground">
                      كلمة المرور الجديدة (اختياري)
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleGeneratePassword("edit")}
                      className="h-9 px-3 text-xs font-bold gap-1.5 rounded-lg border-primary/50 text-primary hover:bg-primary/10"
                    >
                      <Dices className="w-4 h-4" />
                      <span>توليد كلمة جديدة</span>
                    </Button>
                  </div>
                  <div className="relative">
                    <Input
                      type={showEditPassword ? "text" : "password"}
                      placeholder="اتركه فارغاً للإبقاء على كلمة المرور الحالية"
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2 pl-12"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowEditPassword(!showEditPassword)}
                      className="absolute left-2 top-2.5 h-8 w-8 text-muted-foreground hover:text-foreground"
                      title={showEditPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                    >
                      {showEditPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">
                    مفتاح استرداد الحساب (Recovery Key)
                  </label>
                  <div className="relative">
                    <Input
                      type={showEditRecoveryKey ? "text" : "password"}
                      placeholder="مفتاح استرجاع الحساب"
                      value={editRecoveryKey}
                      onChange={(e) => setEditRecoveryKey(e.target.value)}
                      className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2 pl-12"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowEditRecoveryKey(!showEditRecoveryKey)}
                      className="absolute left-2 top-2.5 h-8 w-8 text-muted-foreground hover:text-foreground"
                      title={showEditRecoveryKey ? "إخفاء مفتاح الاسترداد" : "إظهار مفتاح الاسترداد"}
                    >
                      {showEditRecoveryKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">الرابط</label>
                  <Input
                    placeholder="https://..."
                    value={editUrl}
                    onChange={(e) => setEditUrl(e.target.value)}
                    className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2"
                  />
                </div>

                <div>
                  <label className="block text-base font-bold text-foreground mb-1.5">الملاحظات</label>
                  <Input
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="h-13 text-base px-4 font-sans font-bold rounded-xl border-2"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-border/40">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingAccount(null)}
                className="h-13 px-6 rounded-xl text-base font-bold"
              >
                إلغاء
              </Button>
              <Button type="submit" className="h-13 px-8 rounded-xl text-base font-bold shadow-lg">
                حفظ التعديلات
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ================= MODAL: DELETE CONFIRMATION (SHADCN STYLED, REPLACES NATIVE BROWSER POPUP) ================= */}
      <Dialog
        open={Boolean(serviceToDelete || accountToDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setServiceToDelete(null);
            setAccountToDelete(null);
          }
        }}
      >
        <DialogContent className="max-w-md p-7 rounded-3xl bg-card border-2 border-border/80 shadow-2xl text-center">
          <div className="w-16 h-16 rounded-2xl bg-destructive/15 border border-destructive/30 flex items-center justify-center mx-auto text-destructive mb-3">
            <Trash2 className="w-8 h-8" />
          </div>

          <DialogHeader className="text-center space-y-2">
            <DialogTitle className="text-2xl font-black font-thamaniah text-foreground text-center">
              {serviceToDelete ? "تأكيد حذف الخدمة" : "تأكيد حذف الحساب"}
            </DialogTitle>
            <DialogDescription className="text-base text-muted-foreground text-center leading-relaxed">
              {serviceToDelete ? (
                <>
                  هل أنت متأكد من حذف خدمة{" "}
                  <span className="font-bold text-foreground">«{serviceToDelete.name}»</span>؟
                  <br />
                  سيتم حذف هذه الخدمة نهائياً مع كافة الحسابات وكلمات المرور التابعة لها، ولا يمكن
                  التراجع عن هذا الإجراء.
                </>
              ) : (
                <>
                  هل أنت متأكد من حذف حساب{" "}
                  <span className="font-bold text-foreground">«{accountToDelete?.label}»</span>؟
                  <br />
                  سيتم مسح بيانات الحساب وكلمة المرور الخاصة به نهائياً من الخزنة.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-center gap-3 pt-5 border-t border-border/40 mt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setServiceToDelete(null);
                setAccountToDelete(null);
              }}
              className="h-12 px-6 rounded-xl text-base font-bold flex-1"
            >
              إلغاء
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                if (serviceToDelete) {
                  await confirmDeleteService(serviceToDelete.id);
                } else if (accountToDelete) {
                  await confirmDeleteAccount(accountToDelete.serviceId, accountToDelete.accountId);
                }
              }}
              className="h-12 px-6 rounded-xl text-base font-bold shadow-lg gap-2 flex-1"
            >
              <Trash2 className="w-4 h-4" />
              <span>حذف نهائي</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ================= MODAL: SETTINGS & SECURITY ================= */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-3xl p-8 rounded-3xl bg-card border-2 border-border/80 shadow-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-3xl font-black font-thamaniah flex items-center gap-3">
              <Settings className="w-8 h-8 text-white" />
              <span>إعدادات الأمان واستعادة الخزنة</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              إعدادات الأمان واستعادة الخزنة
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-8 pt-4">
            {/* Settings Feedback Banner */}
            {settingsFeedback && (
              <div
                className={`p-4 rounded-2xl border font-semibold text-base flex items-center justify-between gap-3 ${
                  settingsFeedback.type === "success"
                    ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                    : "bg-destructive/15 border-destructive/40 text-destructive-foreground"
                }`}
              >
                <div className="flex items-center gap-3">
                  {settingsFeedback.type === "success" ? (
                    <Check className="w-5 h-5 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 shrink-0" />
                  )}
                  <span>{settingsFeedback.message}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSettingsFeedback(null)}
                  className="h-8 w-8 p-0 rounded-lg hover:bg-white/10"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}

            {passwordChangeSuccess && (
              <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 font-semibold text-base flex items-center gap-3">
                <Check className="w-5 h-5 shrink-0" />
                <span>{passwordChangeSuccess}</span>
              </div>
            )}

            {/* Section 1: Auto-Unlock Toggle */}
            <div className="p-6 rounded-2xl bg-muted/40 border border-border/60 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Shield className="w-6 h-6 text-white" />
                  <div>
                    <h4 className="text-lg font-bold text-foreground">
                      الفتح التلقائي (Passwordless by default)
                    </h4>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {autoUnlockActive
                        ? "مفعّل: يتم فتح كنانة تلقائياً عبر مخزن ويندوز الآمن."
                        : "معطّل: سيُطلب منك رمز الدخول في كل مرة تشغّل فيها التطبيق."}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant={autoUnlockActive ? "destructive" : "default"}
                  onClick={handleToggleAutoUnlock}
                  className="rounded-xl font-bold h-11 px-5 shadow-sm"
                >
                  {autoUnlockActive ? "تعطيل الفتح التلقائي" : "تفعيل الفتح التلقائي"}
                </Button>
              </div>

              {/* Security Warning: Windows Credential Manager */}
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm leading-relaxed flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-amber-300">
                    تنبيه: يتم حفظ رمز الدخول محلياً في Windows Credential Manager.
                  </p>
                  <p className="text-xs text-amber-200/90 leading-relaxed">
                    هذا يعني إمكانية الوصول إليه من أي برنامج يعمل بنفس صلاحياتك.
                    إذا كنت تفضل الأمان الأعلى، قم بتعطيل الفتح التلقائي.
                  </p>
                </div>
              </div>

              {/* Reveal current password if available */}
              {savedPasswordHint && autoUnlockActive && (
                <div className="pt-3 border-t border-border/40 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">الرمز المحفوظ حالياً في ويندوز:</span>
                  <div className="flex items-center gap-2">
                    <span className="font-sans font-bold bg-background px-3 py-1 rounded-lg border border-border">
                      {showSavedPassword ? savedPasswordHint : "••••••••••••"}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowSavedPassword(!showSavedPassword)}
                      className="h-8 w-8 p-0"
                    >
                      {showSavedPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Section: Inactivity Auto-Lock Timeout */}
            <div className="p-6 rounded-2xl bg-muted/40 border border-border/60 space-y-4">
              <div className="flex items-center gap-3">
                <Clock className="w-6 h-6 text-white" />
                <div>
                  <h4 className="text-lg font-bold text-foreground">
                    القفل التلقائي عند الخمول (Auto-Lock Timeout)
                  </h4>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    يقفل التطبيق تلقائياً لحماية بياناتك إذا لم يتم تسجيل أي نشاط لفترة محددة. لن يتم الإقفال أثناء تعبئة النماذج.
                  </p>
                </div>
              </div>

              {/* Timeout Presets Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                {[
                  { label: "دقيقة واحدة", secs: 60 },
                  { label: "5 دقائق (افتراضي)", secs: 300 },
                  { label: "10 دقائق", secs: 600 },
                  { label: "15 دقيقة", secs: 900 },
                  { label: "30 دقيقة", secs: 1800 },
                  { label: "ساعة واحدة", secs: 3600 },
                  { label: "أبداً (تعطيل الإقفال)", secs: null },
                ].map((preset) => {
                  const isSelected = autoLockTimeout === preset.secs;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setCustomTimeoutMinutes("");
                        handleSetAutoLockTimeout(preset.secs);
                      }}
                      className={`h-11 px-3 rounded-xl font-bold text-xs transition-all border cursor-pointer flex items-center justify-center text-center ${
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                          : "bg-card hover:bg-muted border-border/70 text-foreground"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              {/* Custom Minutes Input */}
              <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <span className="text-xs font-bold text-muted-foreground shrink-0">أو حدد مدة مخصصة:</span>
                <div className="flex items-center gap-2 flex-1 max-w-xs">
                  <Input
                    type="number"
                    min="1"
                    max="1440"
                    placeholder="عدد الدقائق (مثال: 45)"
                    value={customTimeoutMinutes}
                    onChange={(e) => setCustomTimeoutMinutes(e.target.value)}
                    className="h-10 text-xs font-bold rounded-xl border-border/70"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={!customTimeoutMinutes || parseInt(customTimeoutMinutes, 10) <= 0}
                    onClick={() => {
                      const mins = parseInt(customTimeoutMinutes, 10);
                      if (mins > 0) {
                        handleSetAutoLockTimeout(mins * 60);
                      }
                    }}
                    className="h-10 px-4 rounded-xl text-xs font-bold shrink-0"
                  >
                    تطبيق
                  </Button>
                </div>
                {autoLockTimeout !== null && (
                  <span className="text-xs font-semibold text-emerald-400 mr-auto">
                    الحالي: {Math.round(autoLockTimeout / 60)} دقيقة
                  </span>
                )}
                {autoLockTimeout === null && (
                  <span className="text-xs font-semibold text-amber-300 mr-auto">
                    الحالي: معطل بالكامل (أبداً)
                  </span>
                )}
              </div>
            </div>
            <div className="p-6 rounded-2xl bg-muted/40 border border-border/60 space-y-5">
              <div className="flex items-center gap-3">
                <Key className="w-6 h-6 text-white" />
                <h4 className="text-lg font-bold text-foreground">
                  تغيير رمز الدخول (PIN) أو كلمة المرور الرئيسية
                </h4>
              </div>

              <form onSubmit={handleChangeMasterPassword} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-foreground mb-1.5">
                      الرمز أو كلمة المرور الجديدة:
                    </label>
                    <Input
                      type="password"
                      placeholder="أدخل الرمز الجديد"
                      value={newMasterPassword}
                      onChange={(e) => setNewMasterPassword(e.target.value)}
                      className="h-12 text-base font-sans font-bold rounded-xl border-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-foreground mb-1.5">
                      تأكيد الرمز الجديد:
                    </label>
                    <Input
                      type="password"
                      placeholder="أعد إدخال الرمز للتأكيد"
                      value={confirmMasterPassword}
                      onChange={(e) => setConfirmMasterPassword(e.target.value)}
                      className="h-12 text-base font-sans font-bold rounded-xl border-2"
                      required
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    className="h-12 px-6 rounded-xl font-bold shadow-md gap-2"
                  >
                    <Check className="w-4 h-4" />
                    <span>حفظ وتطبيق الرمز الجديد</span>
                  </Button>
                </div>
              </form>
            </div>

            {/* Section 3: Emergency Recovery Key */}
            <div className="p-6 rounded-2xl bg-muted/40 border border-border/60 space-y-4">
              <div className="flex items-center gap-3">
                <KeyRound className="w-6 h-6 text-white" />
                <div>
                  <h4 className="text-lg font-bold text-foreground">
                    مفتاح استرداد الطوارئ (Emergency Recovery Key)
                  </h4>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    احفظ هذا المفتاح في مكان آمن. يتيح لك استعادة كامل الخزنة في حال نسيت رمز الدخول!
                  </p>
                </div>
              </div>

              {recoveryKey ? (
                <div className="flex items-center gap-4 bg-background p-4 rounded-2xl border-2 border-primary/40 shadow-inner">
                  <div className="flex-1 font-sans text-xl font-bold tracking-widest text-primary text-center select-all">
                    {recoveryKey}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      navigator.clipboard.writeText(recoveryKey);
                      setCopiedRecoveryKey(true);
                      setTimeout(() => setCopiedRecoveryKey(false), 2000);
                    }}
                    className="h-11 px-5 rounded-xl font-bold gap-2 shrink-0"
                  >
                    {copiedRecoveryKey ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" />
                        <span>تم النسخ</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>نسخ المفتاح</span>
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleFetchRecoveryKey}
                  className="rounded-xl font-bold h-11 px-5 gap-2"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>توليد / عرض مفتاح الطوارئ</span>
                </Button>
              )}
            </div>

            {/* Section 4: Vault Backup & Migration (Export / Import between PC and Laptop) */}
            <div className="p-6 rounded-2xl bg-muted/40 border border-border/60 space-y-4">
              <div className="flex items-center gap-3">
                <FolderSync className="w-6 h-6 text-white" />
                <div>
                  <h4 className="text-lg font-bold text-foreground">
                    النسخ الاحتياطي ونقل الخزنة (بين البي سي واللابتوب)
                  </h4>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    يمكنك تصدير الخزنة المشفرة كملف احتياطي (.dat) لنقلها إلى لابتوب أو فلاش USB، أو استيراد نسخة سابقة.
                  </p>
                </div>
              </div>

              {exportImportStatus && (
                <div
                  className={`p-4 rounded-xl text-sm font-semibold flex items-center gap-3 whitespace-pre-line ${
                    exportImportStatus.type === "success"
                      ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-400"
                      : "bg-destructive/15 border border-destructive/40 text-destructive-foreground"
                  }`}
                >
                  {exportImportStatus.type === "success" ? (
                    <Check className="w-5 h-5 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 shrink-0" />
                  )}
                  <span>{exportImportStatus.message}</span>
                </div>
              )}

              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isProcessingBackup}
                  onClick={handleExportVault}
                  className="rounded-xl font-bold h-12 px-5 gap-2 border-border shadow-sm hover:bg-muted text-white"
                >
                  <Download className="w-4 h-4 text-white" />
                  <span>تصدير نسخة احتياطية مشفرة (.dat)</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  disabled={isProcessingBackup}
                  onClick={handleImportVault}
                  className="rounded-xl font-bold h-12 px-5 gap-2 border-border shadow-sm hover:bg-muted text-white"
                >
                  <Upload className="w-4 h-4 text-white" />
                  <span>استيراد خزنة من ملف (.dat)</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleOpenVaultFolder}
                  className="rounded-xl font-bold h-12 px-5 gap-2 border-border shadow-sm hover:bg-muted text-white"
                >
                  <FolderOpen className="w-4 h-4 text-white" />
                  <span>فتح مسار ملف الخزنة في ويندوز</span>
                </Button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowSettings(false)}
                className="h-12 px-8 rounded-xl font-bold"
              >
                إغلاق
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ================= MODAL: ENABLE AUTO UNLOCK PROMPT ================= */}
      <Dialog open={showAutoUnlockModal} onOpenChange={setShowAutoUnlockModal}>
        <DialogContent className="max-w-md p-6 sm:p-7 rounded-3xl bg-card border-2 border-border/80 shadow-2xl z-[70]">
          <DialogHeader className="text-right">
            <DialogTitle className="text-2xl font-black font-thamaniah flex items-center gap-2.5 text-foreground justify-start">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <span>تفعيل الفتح التلقائي</span>
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-2 leading-relaxed text-right">
              أدخل رمز الدخول (PIN) أو كلمة المرور الرئيسية ليتم حفظها وتشفيرها في مخزن ويندوز الآمن (Windows Credential Manager).
            </DialogDescription>
          </DialogHeader>

          {autoUnlockModalError && (
            <div className="p-3.5 rounded-xl bg-destructive/15 border border-destructive/30 text-destructive-foreground text-sm font-bold flex items-center gap-2.5">
              <ShieldAlert className="w-4 h-4 shrink-0 text-destructive" />
              <span>{autoUnlockModalError}</span>
            </div>
          )}

          <form onSubmit={handleConfirmEnableAutoUnlock} className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-bold text-foreground mb-1.5 text-right">
                أدخل رمز الدخول أو كلمة المرور الحالية:
              </label>
              <div className="relative">
                <Input
                  type={showAutoUnlockPassword ? "text" : "password"}
                  placeholder="أدخل الرمز..."
                  value={autoUnlockPassword}
                  onChange={(e) => {
                    setAutoUnlockPassword(e.target.value);
                    if (autoUnlockModalError) setAutoUnlockModalError(null);
                  }}
                  autoFocus
                  className="h-12 text-base font-sans font-bold rounded-xl border-2 pl-12 pr-4 text-center tracking-widest"
                  disabled={autoUnlockModalLoading}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAutoUnlockPassword(!showAutoUnlockPassword)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8 p-0 rounded-lg text-muted-foreground hover:text-foreground"
                  title={showAutoUnlockPassword ? "إخفاء الرمز" : "إظهار الرمز"}
                >
                  {showAutoUnlockPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/40">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowAutoUnlockModal(false);
                  setAutoUnlockPassword("");
                  setAutoUnlockModalError(null);
                }}
                disabled={autoUnlockModalLoading}
                className="h-11 px-5 rounded-xl font-bold"
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                disabled={autoUnlockModalLoading || !autoUnlockPassword.trim()}
                className="h-11 px-6 rounded-xl font-bold gap-2 shadow-md"
              >
                {autoUnlockModalLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>جاري التحقق...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>تأكيد وتفعيل</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ================= MODAL: EMERGENCY RECOVERY (LOCK SCREEN) ================= */}
      <Dialog open={showRecoveryModal} onOpenChange={setShowRecoveryModal}>
        <DialogContent className="max-w-2xl p-8 rounded-3xl bg-card border-2 border-border/80 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-3xl font-black font-thamaniah flex items-center gap-3">
              <KeyRound className="w-7 h-7 text-primary" />
              <span>استعادة الخزنة عبر مفتاح الطوارئ</span>
            </DialogTitle>
            <DialogDescription className="text-base text-muted-foreground pt-1">
              أدخل مفتاح الاسترداد الخاص بك (مثال: KN-XXXX-XXXX-XXXX-XXXX) لاستعادة الخزنة فوراً.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleRecoverVault} className="space-y-6 pt-4">
            <div>
              <label className="block text-base font-bold text-foreground mb-2">
                مفتاح الاسترداد (Recovery Key):
              </label>
              <Input
                placeholder="KN-XXXX-XXXX-XXXX-XXXX"
                value={inputRecoveryKey}
                onChange={(e) => setInputRecoveryKey(e.target.value)}
                className="h-14 text-xl text-center font-sans font-bold tracking-widest rounded-xl border-2"
                autoFocus
                required
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowRecoveryModal(false)}
                className="h-13 px-6 rounded-xl text-base font-bold"
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                className="h-13 px-8 rounded-xl text-base font-bold shadow-lg gap-2"
              >
                <Unlock className="w-5 h-5" />
                <span>استعادة وفتح الخزنة</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
