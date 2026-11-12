import React, { useEffect, useState, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  SessionGuard,
  unlockWithPassword,
  unlockWithRecoveryKey,
  unlockWithAutoUnlock,
  lockVault,
  processAccountResponse,
} from "./session";
import { clampZoomLevel, computeZoomMetrics } from "./zoom";
import {
  getVisibleRecoveryKeyText,
  revealVaultRecoveryKey,
  copyVaultRecoveryKeySecurely,
} from "./recoveryKeyState";
import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import { SecretInput } from "@/components/ui/secret-input";
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
  AlertTriangle,
  CheckCircle2,
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
  Info,
} from "lucide-react";
import { PasswordStrengthIndicator } from "@/components/ui/password-strength-indicator";
import { AccountFormFields } from "@/components/AccountFormFields";
import { DestructiveConfirmDialog } from "@/components/ui/destructive-confirm-dialog";
import { validateMasterPasswordForm } from "./passwordValidation";
import {
  clearNonEditableDocumentSelection,
  getZoomActionFromKeyboardEvent,
  shouldActivateServiceCard,
  shouldHandleDeleteSelectionShortcut,
  shouldHandleSelectAllShortcut,
  shouldHandleSelectionEscape,
  shouldPreventNativeSelectAll,
} from "./keyboard";
import {
  EditSecretRevealController,
  createHiddenEditSecretMap,
  type EditSecretFieldKey,
  type EditSecretRevealMap,
} from "./editSecretReveal";
import { useTimedNotification } from "./useTimedNotification";
import {
  POPULAR_SERVICES,
  generateCinematicCoverSvg,
  getServiceCoverAsync,
  loadServiceCovers,
} from "@/data/popularServices";
import {
  type AccountFormMode,
  buildAddAccountPayload,
  buildUpdateAccountPayload,
  extractCardPin,
  extractCleanCardNotes,
  isBankOrCardService,
  resolveAccountKind,
} from "./accountForm";
import {
  canCopySecretField,
  executeSecretCopy,
  type SecretCopyField,
  type SecretCopyTarget,
} from "./secretCopy";

interface AccountSummary {
  id: string;
  label: string;
  username: string;
  has_password: boolean;
  has_notes: boolean;
  url?: string;
  account_kind?: AccountFormMode;
}

interface AccountDetail {
  id: string;
  label: string;
  username: string;
  email: string;
  url: string;
  has_password: boolean;
  has_recovery_key: boolean;
  has_notes: boolean;
  has_pin: boolean;
  password?: string | null;
  recovery_key?: string | null;
  notes?: string | null;
  account_kind?: AccountFormMode;
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

interface VaultOperationResult {
  success: boolean;
  warning?: string | null;
}

interface ImportVaultResult {
  success: boolean;
  source_path?: string | null;
  warning?: string | null;
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

// Resolve authoritative persisted account kind (`login` vs `card`).
// Service name may guide creation defaults only, never override an existing account's stored kind.
function isAccountCard(acc: { account_kind?: AccountFormMode | null; notes?: string | null; url?: string | null }): boolean {
  return resolveAccountKind(acc) === "card";
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
  const {
    value: notification,
    show: showNotification,
    dismiss: dismissNotification,
  } = useTimedNotification<{
    type: "error" | "warning" | "success";
    message: string;
    detail?: string;
  }>();

  const setError = (msg: string | null, detail?: string) => {
    if (!msg) {
      dismissNotification();
    } else {
      showNotification({ type: "error", message: msg, detail });
    }
  };

  const setSuccess = (msg: string, detail?: string) => {
    showNotification({ type: "success", message: msg, detail });
  };

  const setWarning = (msg: string, detail?: string) => {
    showNotification({ type: "warning", message: msg, detail });
  };

  const [loading, setLoading] = useState<boolean>(true);

  // Fullscreen state (immersive gaming/media mode)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showFullscreenPill, setShowFullscreenPill] = useState<boolean>(false);
  const fullscreenPillTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-unlock status & Settings (Disabled by default: requires user to opt-in)
  const [autoUnlockActive, setAutoUnlockActive] = useState<boolean>(false);
  const [isAutoUnlockSupported, setIsAutoUnlockSupported] = useState<boolean>(true);
  const [autoUnlockStatus, setAutoUnlockStatus] = useState<{
    supported: boolean;
    platform_name: string;
    available: boolean;
    unavailable_reason?: string | null;
  }>({
    supported: true,
    platform_name: "Windows Credential Manager",
    available: true,
    unavailable_reason: null,
  });
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importPassword, setImportPassword] = useState<string>("");
  const [showImportPassword, setShowImportPassword] = useState<boolean>(false);
  const [importModalError, setImportModalError] = useState<string | null>(null);
  const [revealedCardPinValues, setRevealedCardPinValues] = useState<Record<string, string>>({});
  const [clearRecoveryKey, setClearRecoveryKey] = useState<boolean>(false);
  const [clearCardPin, setClearCardPin] = useState<boolean>(false);
  const sessionGuardRef = useRef<SessionGuard>(new SessionGuard());
  const [savedPasswordHint, setSavedPasswordHint] = useState<string | null>(null);
  const [showSavedPassword, setShowSavedPassword] = useState<boolean>(false);
  const [showAutoUnlockModal, setShowAutoUnlockModal] = useState<boolean>(false);
  const [autoUnlockPassword, setAutoUnlockPassword] = useState<string>("");
  const [showAutoUnlockPassword, setShowAutoUnlockPassword] = useState<boolean>(false);
  const [autoUnlockModalError, setAutoUnlockModalError] = useState<string | null>(null);
  const [autoUnlockModalLoading, setAutoUnlockModalLoading] = useState<boolean>(false);
  const {
    value: settingsFeedback,
    show: showSettingsFeedback,
    dismiss: dismissSettingsFeedback,
  } = useTimedNotification<{ type: "success" | "error"; message: string }>();
  const setSettingsFeedback = (
    val: { type: "success" | "error"; message: string } | null
  ) => {
    if (!val) dismissSettingsFeedback();
    else showSettingsFeedback(val);
  };

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
    if (selectionMode) {
      clearNonEditableDocumentSelection(document);
    }
  }, [selectionMode]);

  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const selectedServiceIdsRef = useRef<string[]>(selectedServiceIds);
  useEffect(() => {
    selectedServiceIdsRef.current = selectedServiceIds;
  }, [selectedServiceIds]);

  const [showBatchDeleteModal, setShowBatchDeleteModal] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

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
  const [confirmCreatePassword, setConfirmCreatePassword] = useState<string>("");
  const [showConfirmCreatePassword, setShowConfirmCreatePassword] = useState<boolean>(false);
  const [createConfirmTouched, setCreateConfirmTouched] = useState<boolean>(false);
  const [isCreatingVault, setIsCreatingVault] = useState<boolean>(false);
  const [showAccPassword, setShowAccPassword] = useState<boolean>(false);
  const [showAccRecoveryKey, setShowAccRecoveryKey] = useState<boolean>(false);
  const [showNewMasterPassword, setShowNewMasterPassword] = useState<boolean>(false);
  const [showConfirmMasterPassword, setShowConfirmMasterPassword] = useState<boolean>(false);

  // Change Password state
  const [newMasterPassword, setNewMasterPassword] = useState<string>("");
  const [confirmMasterPassword, setConfirmMasterPassword] = useState<string>("");
  const [settingsConfirmTouched, setSettingsConfirmTouched] = useState<boolean>(false);
  const [isChangingMasterPassword, setIsChangingMasterPassword] = useState<boolean>(false);
  const {
    value: passwordChangeFeedback,
    show: showPasswordChangeFeedback,
    dismiss: dismissPasswordChangeFeedback,
  } = useTimedNotification<{ type: "success" | "warning"; message: string }>();

  // Emergency Recovery Key state
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [showVaultRecoveryKey, setShowVaultRecoveryKey] = useState<boolean>(false);
  const [copiedRecoveryKey, setCopiedRecoveryKey] = useState<boolean>(false);
  const copiedRecoveryKeyTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [showRecoveryModal, setShowRecoveryModal] = useState<boolean>(false);
  const [inputRecoveryKey, setInputRecoveryKey] = useState<string>("");
  const [showInputRecoveryKey, setShowInputRecoveryKey] = useState<boolean>(false);

  // Zoom level state & HUD indicator
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const zoomMetrics = useMemo(() => computeZoomMetrics(zoomLevel), [zoomLevel]);
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
  const {
    value: exportImportStatus,
    show: showExportImportStatus,
    dismiss: dismissExportImportStatus,
  } = useTimedNotification<{
    type: "success" | "error";
    message: string;
  }>();
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
    isCard?: boolean;
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
  const [isSavingAccount, setIsSavingAccount] = useState<boolean>(false);
  const generateReqIdRef = useRef<number>(0);

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
  const [editSecretState, setEditSecretState] = useState<EditSecretRevealMap>(
    createHiddenEditSecretMap
  );
  const editSecretControllerRef = useRef<EditSecretRevealController | null>(null);
  if (!editSecretControllerRef.current) {
    editSecretControllerRef.current = new EditSecretRevealController((next) => {
      setEditSecretState(next);
    });
  }
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
  const [showCardPin, setShowCardPin] = useState<boolean>(false);
  const [revealedCardNumbers, setRevealedCardNumbers] = useState<Record<string, boolean>>({});
  const [revealedCardCvvs, setRevealedCardCvvs] = useState<Record<string, boolean>>({});
  const [revealedCardPins, setRevealedCardPins] = useState<Record<string, boolean>>({});
  const [revealedAccountPasswords, setRevealedAccountPasswords] = useState<Record<string, boolean>>({});
  const [revealedAccountRecoveryKeys, setRevealedAccountRecoveryKeys] = useState<Record<string, boolean>>({});

  const toggleRevealAccountPassword = async (serviceId: string, account: AccountDetail) => {
    const accId = account.id;
    const epoch = sessionGuardRef.current.epoch;
    if (revealedAccountPasswords[accId]) {
      setRevealedAccountPasswords((prev) => ({ ...prev, [accId]: false }));
      // Wipe decrypted password from memory on hide
      setServiceAccounts((prev) =>
        prev.map((a) => (a.id === accId ? { ...a, password: null } : a))
      );
    } else {
      try {
        const pwd = await invoke<string>("get_account_password", {
          serviceId,
          accountId: accId,
        });
        if (!sessionGuardRef.current.isResponseValid(epoch)) return;
        setServiceAccounts((prev) =>
          prev.map((a) => (a.id === accId ? { ...a, password: pwd } : a))
        );
        setRevealedAccountPasswords((prev) => ({ ...prev, [accId]: true }));
      } catch (err) {
        console.error("Failed to fetch account password:", err);
      }
    }
  };

  const toggleRevealAccountRecoveryKey = async (serviceId: string, account: AccountDetail) => {
    const accId = account.id;
    const epoch = sessionGuardRef.current.epoch;
    if (revealedAccountRecoveryKeys[accId]) {
      setRevealedAccountRecoveryKeys((prev) => ({ ...prev, [accId]: false }));
      // Wipe recovery key from memory on hide
      setServiceAccounts((prev) =>
        prev.map((a) => (a.id === accId ? { ...a, recovery_key: null } : a))
      );
    } else {
      try {
        const key = await invoke<string>("get_account_recovery_key", {
          serviceId,
          accountId: accId,
        });
        if (!sessionGuardRef.current.isResponseValid(epoch)) return;
        setServiceAccounts((prev) =>
          prev.map((a) => (a.id === accId ? { ...a, recovery_key: key } : a))
        );
        setRevealedAccountRecoveryKeys((prev) => ({ ...prev, [accId]: true }));
      } catch (err) {
        console.error("Failed to fetch account recovery key:", err);
      }
    }
  };

  const toggleRevealCardCvv = async (serviceId: string, account: AccountDetail) => {
    const accId = account.id;
    const epoch = sessionGuardRef.current.epoch;
    if (revealedCardCvvs[accId]) {
      setRevealedCardCvvs((prev) => ({ ...prev, [accId]: false }));
      // Wipe card CVV from memory on hide
      setServiceAccounts((prev) =>
        prev.map((a) => (a.id === accId ? { ...a, recovery_key: null } : a))
      );
    } else {
      try {
        const cvv = await invoke<string>("get_account_recovery_key", {
          serviceId,
          accountId: accId,
        });
        if (!sessionGuardRef.current.isResponseValid(epoch)) return;
        setServiceAccounts((prev) =>
          prev.map((a) => (a.id === accId ? { ...a, recovery_key: cvv } : a))
        );
        setRevealedCardCvvs((prev) => ({ ...prev, [accId]: true }));
      } catch (err) {
        console.error("Failed to fetch card CVV:", err);
      }
    }
  };

  const toggleRevealCardPin = async (serviceId: string, account: AccountDetail) => {
    const accId = account.id;
    const epoch = sessionGuardRef.current.epoch;
    if (revealedCardPins[accId]) {
      setRevealedCardPins((prev) => ({ ...prev, [accId]: false }));
      // Wipe card PIN from memory on hide
      setRevealedCardPinValues((prev) => {
        const copy = { ...prev };
        delete copy[accId];
        return copy;
      });
    } else {
      try {
        const pin = await invoke<string>("get_account_pin", {
          serviceId,
          accountId: accId,
        });
        if (!sessionGuardRef.current.isResponseValid(epoch)) return;
        setRevealedCardPinValues((prev) => ({ ...prev, [accId]: pin }));
        setRevealedCardPins((prev) => ({ ...prev, [accId]: true }));
      } catch (err) {
        console.error("Failed to fetch card pin:", err);
      }
    }
  };

  // Copy feedback state: key = `${accountId}_${field}`
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedKeyTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearDetailRevealedSecrets = () => {
    setRevealedAccountPasswords({});
    setRevealedAccountRecoveryKeys({});
    setRevealedCardNumbers({});
    setRevealedCardCvvs({});
    setRevealedCardPins({});
    setRevealedCardPinValues({});
    setServiceAccounts((prev) =>
      prev.map((a) => ({ ...a, password: null, recovery_key: null }))
    );
  };

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

  const unlockedRef = useRef<boolean>(false);
  useEffect(() => {
    unlockedRef.current = unlocked;
  }, [unlocked]);

  const displayedServicesRef = useRef<ServiceSummary[]>([]);
  useEffect(() => {
    displayedServicesRef.current = displayedServices;
  }, [displayedServices]);

  const hasOpenDialogRef = useRef<boolean>(false);
  const isAnyDialogOpen =
    Boolean(selectedServiceId) ||
    showAddService ||
    showEditService ||
    showAddAccount ||
    Boolean(editingAccount) ||
    Boolean(serviceToDelete) ||
    Boolean(accountToDelete) ||
    showBatchDeleteModal ||
    showSettings ||
    showRecoveryModal ||
    showImportModal ||
    showAutoUnlockModal;
  useEffect(() => {
    hasOpenDialogRef.current = isAnyDialogOpen;
    if (isAnyDialogOpen) {
      clearNonEditableDocumentSelection(document);
    }
  }, [isAnyDialogOpen]);

  // Zoom management helper with on-screen HUD toast
  const applyZoom = (newLevel: number) => {
    const clamped = clampZoomLevel(newLevel);
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

  // Fetch accounts when service detail modal is open with session guard
  const fetchServiceAccounts = async (serviceId: string) => {
    const epoch = sessionGuardRef.current.epoch;
    try {
      setLoadingAccounts(true);
      const accs = await invoke<AccountDetail[]>("get_service_accounts", { serviceId });
      processAccountResponse(sessionGuardRef.current, epoch, accs, (validAccs) => {
        setRevealedAccountPasswords({});
        setRevealedAccountRecoveryKeys({});
        setRevealedCardNumbers({});
        setRevealedCardCvvs({});
        setRevealedCardPins({});
        setRevealedCardPinValues({});
        setServiceAccounts(validAccs);
      });
    } catch (err: any) {
      if (!sessionGuardRef.current.isResponseValid(epoch)) return;
      setError(err?.toString() || "فشل جلب تفاصيل الحسابات");
    } finally {
      if (sessionGuardRef.current.epoch === epoch) {
        setLoadingAccounts(false);
      }
    }
  };

  useEffect(() => {
    setRevealedAccountPasswords({});
    setRevealedAccountRecoveryKeys({});
    setRevealedCardNumbers({});
    setRevealedCardCvvs({});
    setRevealedCardPins({});
    setRevealedCardPinValues({});
    editSecretControllerRef.current?.setTarget(null, null);

    if (selectedServiceId) {
      fetchServiceAccounts(selectedServiceId);
    } else {
      setServiceAccounts([]);
      setEditingAccount(null);
    }
  }, [selectedServiceId]);

  // Always hide and clear displayed application recovery key when locking or closing settings
  useEffect(() => {
    if (!unlocked || !showSettings) {
      setShowVaultRecoveryKey(false);
      setRecoveryKey(null);
      setCopiedRecoveryKey(false);
    }
  }, [unlocked, showSettings]);

  // Initial startup logic: Check vault existence, sync auto-lock timeout, and attempt auto-unlock
  const initApp = async () => {
    try {
      setLoading(true);
      setError(null);

      const isExist = await invoke<boolean>("vault_exists");
      setExists(isExist);

      const status = await invoke<{
        supported: boolean;
        platform_name: string;
        available: boolean;
        unavailable_reason?: string | null;
      }>("get_auto_unlock_status").catch(() => ({
        supported: false,
        platform_name: "Unknown",
        available: false,
        unavailable_reason: null,
      }));
      setAutoUnlockStatus(status);
      setIsAutoUnlockSupported(status.supported);

      let isAutoEnabled = false;
      if (status.supported && status.available) {
        isAutoEnabled = await invoke<boolean>("is_auto_unlock_enabled").catch(() => false);
      }
      setAutoUnlockActive(isAutoEnabled);

      // Sync saved auto-lock timeout with backend
      try {
        await invoke("set_auto_lock_timeout", { seconds: autoLockTimeout });
      } catch (err) {
        console.warn("Failed to sync auto-lock timeout:", err);
      }

      if (isExist && isAutoEnabled) {
        const unlockedViaStore = await unlockWithAutoUnlock(
          sessionGuardRef.current,
          invoke,
          async () => {
            await fetchSummary();
          }
        );
        if (unlockedViaStore) {
          return;
        }
      }
    } catch (err: any) {
      console.warn("Auto-unlock not available or failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const purgeAllSensitiveState = () => {
    sessionGuardRef.current.lock();
    setUnlocked(false);
    setSummary(null);
    setSelectedServiceId(null);
    setServiceAccounts([]);
    setPassword("");
    setConfirmCreatePassword("");
    setCreateConfirmTouched(false);
    setShowConfirmCreatePassword(false);
    setIsCreatingVault(false);
    setSavedPasswordHint(null);
    setShowSavedPassword(false);
    setAutoUnlockPassword("");
    setShowAutoUnlockPassword(false);
    setRecoveryKey(null);
    setShowVaultRecoveryKey(false);
    setCopiedRecoveryKey(false);
    setInputRecoveryKey("");
    setShowInputRecoveryKey(false);
    setNewMasterPassword("");
    setConfirmMasterPassword("");
    setSettingsConfirmTouched(false);
    setIsChangingMasterPassword(false);
    setIsSavingAccount(false);
    setShowNewMasterPassword(false);
    setShowConfirmMasterPassword(false);
    setAccPassword("");
    setAccRecoveryKey("");
    setAccNotes("");
    setAccUsername("");
    setAccEmail("");
    setAccLabel("");
    setEditPassword("");
    editSecretControllerRef.current?.setTarget(null, null);
    setEditRecoveryKey("");
    setEditNotes("");
    setEditUsername("");
    setEditEmail("");
    setEditLabel("");
    setEditingAccount(null);
    setCardHolder("");
    setCardNumber("");
    setCardExpiry("");
    setCardCvv("");
    setCardPin("");
    setClearRecoveryKey(false);
    setClearCardPin(false);
    setIsDeleting(false);
    setShowBatchDeleteModal(false);
    setRevealedAccountPasswords({});
    setRevealedAccountRecoveryKeys({});
    setRevealedCardNumbers({});
    setRevealedCardCvvs({});
    setRevealedCardPins({});
    setRevealedCardPinValues({});
    setShowUnlockPassword(false);
    setShowCreatePassword(false);
    setShowAccPassword(false);
    setShowAccRecoveryKey(false);
    setShowCardNumber(false);
    setShowCardCvv(false);
    setShowCardPin(false);
    setCopiedKey(null);
    if (copiedKeyTimerRef.current) {
      clearTimeout(copiedKeyTimerRef.current);
      copiedKeyTimerRef.current = null;
    }
    if (copiedRecoveryKeyTimerRef.current) {
      clearTimeout(copiedRecoveryKeyTimerRef.current);
      copiedRecoveryKeyTimerRef.current = null;
    }
    dismissSettingsFeedback();
    dismissPasswordChangeFeedback();
    dismissExportImportStatus();
    setShowAddService(false);
    setShowEditService(false);
    setShowAddAccount(false);
    setShowSettings(false);
    setShowRecoveryModal(false);
    setShowAutoUnlockModal(false);
    setShowImportModal(false);
    setImportPassword("");
    setImportModalError(null);
    setServiceToDelete(null);
    setAccountToDelete(null);
  };

  useEffect(() => {
    initApp();

    // Listen to auto-lock event from backend
    const unlistenPromise = listen("vault-auto-locked", () => {
      purgeAllSensitiveState();
      invoke("trim_app_memory").catch(() => {});
      setWarning("تم إقفال Kinana تلقائياً بسبب الخمول لحماية بياناتك.");
    });

    const syncFullscreen = async () => {
      try {
        const full = await invoke<boolean>("is_fullscreen");
        setIsFullscreen(full);
      } catch {}
    };

    syncFullscreen();
    window.addEventListener("resize", syncFullscreen);

    const handleBlur = () => {
      setShowSavedPassword(false);
      setSavedPasswordHint(null);
      setShowVaultRecoveryKey(false);
      setRecoveryKey(null);
      editSecretControllerRef.current?.hideAll();
      clearDetailRevealedSecrets();
    };
    window.addEventListener("blur", handleBlur);

    // Keyboard shortcuts: F11 fullscreen, selection mode (Ctrl/Cmd+A, Delete, Esc), Ctrl/Cmd zoom
    const handleKeyDown = async (e: KeyboardEvent) => {
      const dialogOpenInDom = Boolean(document.querySelector("[role='dialog']"));
      const shortcutCtx = {
        unlocked: unlockedRef.current,
        selectionMode: selectionModeRef.current,
        selectedCount: selectedServiceIdsRef.current.length,
        hasOpenDialog: hasOpenDialogRef.current || dialogOpenInDom,
        target: e.target,
      };

      if (shouldHandleSelectAllShortcut(e, shortcutCtx)) {
        e.preventDefault();
        clearNonEditableDocumentSelection(document);
        setSelectedServiceIds(displayedServicesRef.current.map((s) => s.id));
        return;
      }

      if (shouldPreventNativeSelectAll(e, e.target)) {
        e.preventDefault();
        clearNonEditableDocumentSelection(document);
        return;
      }

      if (shouldHandleDeleteSelectionShortcut(e, shortcutCtx)) {
        e.preventDefault();
        setShowBatchDeleteModal(true);
        return;
      }

      if (shouldHandleSelectionEscape(e, shortcutCtx)) {
        e.preventDefault();
        setSelectionMode(false);
        setSelectedServiceIds([]);
        return;
      }

      if (e.key === "F11") {
        e.preventDefault();
        try {
          const isFull = await invoke<boolean>("toggle_fullscreen");
          setIsFullscreen(isFull);
        } catch (err) {
          console.warn("Fullscreen toggle failed:", err);
        }
        return;
      }

      if (e.key === "Escape") {
        if (shortcutCtx.hasOpenDialog) return;
        try {
          const isFull = await invoke<boolean>("is_fullscreen");
          if (isFull) {
            e.preventDefault();
            const next = await invoke<boolean>("toggle_fullscreen");
            setIsFullscreen(next);
          }
        } catch {}
        return;
      }

      const zoomAction = getZoomActionFromKeyboardEvent(e);
      if (zoomAction === "in") {
        e.preventDefault();
        applyZoom(zoomLevelRef.current + 0.1);
      } else if (zoomAction === "out") {
        e.preventDefault();
        applyZoom(zoomLevelRef.current - 0.1);
      } else if (zoomAction === "reset") {
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
      window.removeEventListener("blur", handleBlur);
      if (zoomHudTimerRef.current) clearTimeout(zoomHudTimerRef.current);
      if (copiedKeyTimerRef.current) clearTimeout(copiedKeyTimerRef.current);
      if (copiedRecoveryKeyTimerRef.current) clearTimeout(copiedRecoveryKeyTimerRef.current);
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

  // Ping activity once when a modal opens to ensure a fresh timeout window without infinite lock suppression
  const isAnyModalActive =
    showAddAccount ||
    Boolean(editingAccount) ||
    showAddService ||
    showEditService ||
    showSettings ||
    showRecoveryModal ||
    showImportModal;

  useEffect(() => {
    if (!unlocked || !isAnyModalActive) return;
    invoke("ping_activity").catch(() => {});
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
    if (selectedServiceIds.length === 0 || isDeleting) return;
    try {
      setIsDeleting(true);
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
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingVault) return;
    const validation = validateMasterPasswordForm({
      password,
      confirmPassword: confirmCreatePassword,
      confirmTouched: createConfirmTouched,
      isSubmitting: isCreatingVault,
    });
    if (!validation.minLengthMet) {
      setError("يجب أن تتكون كلمة المرور الرئيسية من 8 خانات على الأقل لحماية الخزنة.");
      return;
    }
    if (!validation.passwordsMatch) {
      setCreateConfirmTouched(true);
      setError("كلمتا المرور غير متطابقتين");
      return;
    }
    try {
      setIsCreatingVault(true);
      setError(null);
      await invoke("create_vault", { password });
      setPassword("");
      setConfirmCreatePassword("");
      setCreateConfirmTouched(false);
      setShowCreatePassword(false);
      setShowConfirmCreatePassword(false);
      sessionGuardRef.current.unlock();
      await fetchSummary();
      setExists(true);
      setAutoUnlockActive(false);
    } catch (err: any) {
      setError(err?.toString() || "فشل إنشاء الخزنة");
    } finally {
      setIsCreatingVault(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    try {
      setError(null);
      await unlockWithPassword(sessionGuardRef.current, invoke, password, async () => {
        setPassword("");
        await fetchSummary();
      });
    } catch (err: any) {
      setError(err?.toString() || "فشل فتح الخزنة: كلمة المرور غير صحيحة");
    }
  };

  const handleLock = async () => {
    try {
      await lockVault(sessionGuardRef.current, invoke, () => {
        purgeAllSensitiveState();
      });
      invoke("trim_app_memory").catch(() => {});
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
          message: "تم تعطيل الفتح التلقائي: سيُطلب منك رمز الدخول في كل مرة تفتح فيها Kinana.",
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
      setSavedPasswordHint(null);
      setShowSavedPassword(false);
      setAutoUnlockPassword("");
      setShowAutoUnlockModal(false);
      setSettingsFeedback({
        type: "success",
        message: "تم تفعيل الفتح التلقائي بنجاح: سيتم فتح Kinana تلقائياً عند كل تشغيل.",
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

  // Change Master Password
  const handleChangeMasterPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isChangingMasterPassword) return;
    const validation = validateMasterPasswordForm({
      password: newMasterPassword,
      confirmPassword: confirmMasterPassword,
      confirmTouched: settingsConfirmTouched,
      isSubmitting: isChangingMasterPassword,
    });
    if (!newMasterPassword) {
      setError("يرجى إدخال كلمة المرور الرئيسية الجديدة");
      return;
    }
    if (!validation.minLengthMet) {
      setError("يجب أن تتكون كلمة المرور الرئيسية الجديدة من 8 خانات على الأقل لضمان الحماية ضد التخمين.");
      return;
    }
    if (!validation.passwordsMatch) {
      setSettingsConfirmTouched(true);
      setError("كلمتا المرور غير متطابقتين");
      return;
    }
    try {
      setIsChangingMasterPassword(true);
      setError(null);
      const res = await invoke<VaultOperationResult>("change_master_password", { newPassword: newMasterPassword });
      setSavedPasswordHint(null);
      setShowSavedPassword(false);
      setNewMasterPassword("");
      setConfirmMasterPassword("");
      setSettingsConfirmTouched(false);
      setShowNewMasterPassword(false);
      setShowConfirmMasterPassword(false);
      if (res?.warning) {
        showPasswordChangeFeedback({
          type: "warning",
          message: `تم تغيير كلمة المرور الرئيسية بنجاح مع تنبيه: ${res.warning}`,
        });
      } else {
        showPasswordChangeFeedback({
          type: "success",
          message: "تم تغيير كلمة المرور الرئيسية بنجاح وتحديث بيانات الحماية!",
        });
      }
    } catch (err: any) {
      setError(err?.toString() || "فشل تغيير كلمة المرور الرئيسية");
    } finally {
      setIsChangingMasterPassword(false);
    }
  };

  // Toggle Reveal/Hide Application Emergency Recovery Key (masked by default)
  const handleToggleVaultRecoveryKey = async () => {
    if (showVaultRecoveryKey) {
      setShowVaultRecoveryKey(false);
      setRecoveryKey(null);
      return;
    }
    try {
      setSettingsFeedback(null);
      const revealed = await revealVaultRecoveryKey(sessionGuardRef.current, invoke);
      if (revealed) {
        setRecoveryKey(revealed.value);
        setShowVaultRecoveryKey(revealed.revealed);
      }
    } catch (err: any) {
      setSettingsFeedback({
        type: "error",
        message: err?.toString() || "فشل استرجاع مفتاح الطوارئ",
      });
    }
  };

  // Copy Application Recovery Key via backend clipboard without revealing it in UI
  const handleCopyVaultRecoveryKey = async () => {
    try {
      await copyVaultRecoveryKeySecurely(invoke);
      setCopiedRecoveryKey(true);
      if (copiedRecoveryKeyTimerRef.current) clearTimeout(copiedRecoveryKeyTimerRef.current);
      copiedRecoveryKeyTimerRef.current = setTimeout(() => {
        setCopiedRecoveryKey(false);
        copiedRecoveryKeyTimerRef.current = null;
      }, 2000);
    } catch (err: any) {
      setSettingsFeedback({
        type: "error",
        message: err?.toString() || "فشل نسخ مفتاح الطوارئ",
      });
    }
  };

  // Recover Vault with Emergency Key
  const handleRecoverVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputRecoveryKey.trim()) return;
    try {
      setError(null);
      await unlockWithRecoveryKey(sessionGuardRef.current, invoke, inputRecoveryKey, async () => {
        setInputRecoveryKey("");
        setShowInputRecoveryKey(false);
        setShowRecoveryModal(false);
        await fetchSummary();
        setSuccess("تمت استعادة الخزنة بنجاح عبر مفتاح الطوارئ! يُنصح بتعيين رمز دخول جديد من الإعدادات.");
      });
    } catch (err: any) {
      setError(err?.toString() || "فشل الاستعادة: مفتاح الطوارئ غير صحيح أو غير مطابق");
    }
  };

  // Export Vault Backup to .dat / .kinana file
  const handleExportVault = async () => {
    try {
      setIsProcessingBackup(true);
      dismissExportImportStatus();
      const savedPath = await invoke<string | null>("export_vault_backup");
      if (savedPath) {
        showExportImportStatus({
          type: "success",
          message: `تم تصدير نسخة الخزنة المشفرة بنجاح إلى:\n${savedPath}`,
        });
      }
    } catch (err: any) {
      showExportImportStatus(
        {
          type: "error",
          message: err?.toString() || "فشل تصدير الخزنة",
        },
        { durationMs: null }
      );
    } finally {
      setIsProcessingBackup(false);
    }
  };

  // Open Secure Import Modal
  const handleOpenImportModal = () => {
    setImportPassword("");
    setShowImportPassword(false);
    setImportModalError(null);
    setShowImportModal(true);
  };

  // Perform Verified Cryptographic Import of Backup Vault
  const handlePerformImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importPassword.trim()) {
      setImportModalError("يرجى إدخال كلمة مرور الخزنة المستوردة للتحقق من سلامة التشفير");
      return;
    }
    try {
      setIsProcessingBackup(true);
      setImportModalError(null);
      const res = await invoke<ImportVaultResult>("import_vault_backup", {
        password: importPassword.trim(),
      });
      if (res && res.success && res.source_path) {
        setShowImportModal(false);
        setImportPassword("");
        setShowSettings(false);
        purgeAllSensitiveState();
        setExists(true);
        if (res.warning) {
          setWarning(
            "تم استيراد الخزنة بنجاح مع تنبيه، يرجى إدخال كلمة المرور الخاصة بها لفتحها.",
            res.warning
          );
        } else {
          setSuccess(
            "تم استيراد الخزنة بنجاح، يرجى إدخال كلمة المرور الخاصة بها لفتحها."
          );
        }
      }
    } catch (err: any) {
      setImportModalError(err?.toString() || "فشل استيراد الخزنة");
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

  const resetAccountFormFields = () => {
    generateReqIdRef.current += 1;
    setAccLabel("");
    setAccUsername("");
    setAccEmail("");
    setAccPassword("");
    setAccRecoveryKey("");
    setAccUrl("");
    setAccNotes("");
    setEditLabel("");
    setEditUsername("");
    setEditEmail("");
    setEditPassword("");
    editSecretControllerRef.current?.setTarget(null, null);
    setEditRecoveryKey("");
    setEditUrl("");
    setEditNotes("");
    setCardHolder("");
    setCardNumber("");
    setCardExpiry("");
    setCardCvv("");
    setCardPin("");
    setShowCardNumber(false);
    setShowCardCvv(false);
    setShowCardPin(false);
    setShowAccPassword(false);
    setShowAccRecoveryKey(false);
    setClearRecoveryKey(false);
    setClearCardPin(false);
  };

  const closeAddAccountModal = () => {
    resetAccountFormFields();
    setAddAccountError(null);
    setShowAddAccount(false);
  };

  const closeEditAccountModal = () => {
    resetAccountFormFields();
    setEditAccountError(null);
    setEditingAccount(null);
  };

  // Generate Password Helper
  const handleGeneratePassword = async (target: "add" | "edit") => {
    const reqId = ++generateReqIdRef.current;
    const epoch = sessionGuardRef.current.epoch;
    try {
      const generated = await invoke<string>("generate_password", {
        length: 20,
        useSymbols: true,
      });
      if (!sessionGuardRef.current.isResponseValid(epoch) || generateReqIdRef.current !== reqId) {
        return;
      }
      if (target === "add") {
        setAccPassword(generated);
      } else {
        editSecretControllerRef.current?.onDraftChanged(
          "password",
          generated,
          Boolean(editingAccount?.has_password)
        );
        setEditPassword(generated);
      }
    } catch (err: any) {
      const msg = err?.toString() || "فشل توليد كلمة المرور";
      if (target === "add") {
        setAddAccountError(msg);
      } else {
        setEditAccountError(msg);
      }
    }
  };

  const handleEditSecretDraftChange = (
    field: EditSecretFieldKey,
    nextVal: string,
    hasExistingSecret: boolean,
    setDraft: (val: string) => void
  ) => {
    editSecretControllerRef.current?.onDraftChanged(
      field,
      nextVal,
      hasExistingSecret
    );
    setDraft(nextVal);
  };

  // Explicit on-demand guarded reveal/hide across all Edit Account / Card secret fields
  const handleToggleEditSecretField = async (field: EditSecretFieldKey) => {
    const controller = editSecretControllerRef.current;
    if (!controller) return;

    const hasExistingMap: Record<EditSecretFieldKey, boolean> = {
      password: Boolean(editingAccount?.has_password),
      recoveryKey: Boolean(editingAccount?.has_recovery_key),
      cardNumber: Boolean(editingAccount?.has_password),
      cardCvv: Boolean(editingAccount?.has_recovery_key),
      cardPin: Boolean(editingAccount?.has_pin),
    };
    const draftMap: Record<EditSecretFieldKey, string> = {
      password: editPassword,
      recoveryKey: editRecoveryKey,
      cardNumber,
      cardCvv,
      cardPin,
    };
    const pendingRemovalMap: Record<EditSecretFieldKey, boolean> = {
      password: false,
      recoveryKey: clearRecoveryKey,
      cardNumber: false,
      cardCvv: clearRecoveryKey,
      cardPin: clearCardPin,
    };

    const result = await controller.toggle(
      {
        field,
        serviceId: selectedServiceId,
        accountId: editingAccount?.id,
        hasExistingSecret: hasExistingMap[field],
        hasDraftValue: draftMap[field].length > 0,
        markedForRemoval: pendingRemovalMap[field],
      },
      sessionGuardRef.current,
      invoke
    );
    if (!result.stale && result.error) {
      const err: any = result.error;
      setEditAccountError(err?.toString() || "فشل استرجاع القيمة السرية المحفوظة");
    }
  };

  // Explicit on-demand guarded reveal/hide for Edit password field
  const handleToggleEditPasswordReveal = () => handleToggleEditSecretField("password");

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
    if (isDeleting) return;
    try {
      setIsDeleting(true);
      setError(null);
      const updated = await invoke<VaultSummary>("delete_service", { serviceId });
      setSummary(updated);
      setSelectedServiceId(null);
      setServiceToDelete(null);
    } catch (err: any) {
      setError(err?.toString() || "فشل حذف الخدمة");
    } finally {
      setIsDeleting(false);
    }
  };

  // Add Account Handler (Supports both standard login accounts and dedicated bank cards)
  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedServiceId || isSavingAccount) return;
    try {
      setIsSavingAccount(true);
      setAddAccountError(null);
      const payload = buildAddAccountPayload(
        selectedServiceId,
        accountFormMode,
        {
          label: accLabel,
          username: accUsername,
          email: accEmail,
          password: accPassword,
          recoveryKey: accRecoveryKey,
          url: accUrl,
          notes: accNotes,
        },
        {
          label: accLabel,
          holder: cardHolder,
          number: cardNumber,
          expiry: cardExpiry,
          cvv: cardCvv,
          pin: cardPin,
          notes: accNotes,
        }
      );

      const updated = await invoke<VaultSummary>("add_account", { ...payload });
      setSummary(updated);
      await fetchServiceAccounts(selectedServiceId);
      closeAddAccountModal();
    } catch (err: any) {
      setAddAccountError(err?.toString() || "فشل إضافة الحساب");
    } finally {
      setIsSavingAccount(false);
    }
  };

  // Duplicate / Clone Account Handler (Pre-fills Add modal with cloned values)
  const handleDuplicateAccount = async (acc: AccountDetail) => {
    const isCard = isAccountCard(acc);
    resetAccountFormFields();
    setCopiedKey((prev) =>
      prev && (prev.startsWith("add_") || prev.startsWith("edit_")) ? null : prev
    );
    setAccountFormMode(isCard ? "card" : "login");
    setAccLabel(`${acc.label || (isCard ? "بطاقة" : "حساب")} (نسخة)`);
    if (isCard) {
      setCardHolder(acc.username || "");
      setCardExpiry(acc.url || "");
      setAccNotes(extractCleanCardNotes(acc.notes));
    } else {
      setAccUsername(acc.username || "");
      setAccEmail(acc.email || "");
      setAccUrl(acc.url || "");
      setAccNotes(acc.notes || "");
    }

    setAddAccountError(null);
    setShowAddAccount(true);
  };

  // Open Edit Account Modal (strictly starts masked with zero preloaded secrets)
  const openEditAccountModal = (acc: AccountDetail) => {
    const isCard = isAccountCard(acc);
    resetAccountFormFields();
    setCopiedKey((prev) =>
      prev && (prev.startsWith("add_") || prev.startsWith("edit_")) ? null : prev
    );
    editSecretControllerRef.current?.setTarget(selectedServiceId, acc.id);
    setEditingAccount(acc);
    setAccountFormMode(isCard ? "card" : "login");
    setEditLabel(acc.label || "");
    if (isCard) {
      setCardHolder(acc.username || "");
      setCardExpiry(acc.url || "");
      setEditNotes(extractCleanCardNotes(acc.notes));
    } else {
      setEditUsername(acc.username || "");
      setEditEmail(acc.email || "");
      setEditUrl(acc.url || "");
      setEditNotes(acc.notes || "");
    }
    setEditAccountError(null);
  };

  // Update Account Handler
  const handleUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedServiceId || !editingAccount || isSavingAccount) return;
    try {
      setIsSavingAccount(true);
      setEditAccountError(null);
      const payload = buildUpdateAccountPayload(
        selectedServiceId,
        editingAccount.id,
        accountFormMode,
        {
          label: editLabel,
          username: editUsername,
          email: editEmail,
          password: editPassword,
          recoveryKey: editRecoveryKey,
          url: editUrl,
          notes: editNotes,
          clearRecoveryKey,
        },
        {
          label: editLabel,
          holder: cardHolder,
          number: cardNumber,
          expiry: cardExpiry,
          cvv: cardCvv,
          pin: cardPin,
          notes: editNotes,
          clearRecoveryKey,
          clearPin: clearCardPin,
        }
      );

      const updated = await invoke<VaultSummary>("update_account", { ...payload });
      setSummary(updated);
      await fetchServiceAccounts(selectedServiceId);
      closeEditAccountModal();
    } catch (err: any) {
      setEditAccountError(err?.toString() || "فشل تحديث بيانات الحساب");
    } finally {
      setIsSavingAccount(false);
    }
  };

  // Confirm and Execute Account Deletion
  const confirmDeleteAccount = async (serviceId: string, accountId: string) => {
    if (isDeleting) return;
    try {
      setIsDeleting(true);
      setError(null);
      const updated = await invoke<VaultSummary>("delete_account", { serviceId, accountId });
      setSummary(updated);
      await fetchServiceAccounts(serviceId);
      setAccountToDelete(null);
    } catch (err: any) {
      setError(err?.toString() || "فشل حذف الحساب");
    } finally {
      setIsDeleting(false);
    }
  };

  const triggerCopiedIndicator = (key: string) => {
    setCopiedKey(key);
    if (copiedKeyTimerRef.current) clearTimeout(copiedKeyTimerRef.current);
    copiedKeyTimerRef.current = setTimeout(() => {
      setCopiedKey(null);
      copiedKeyTimerRef.current = null;
    }, 2000);
  };

  const getFormSecretCopyTarget = (
    isEditForm: boolean,
    field: SecretCopyField
  ): SecretCopyTarget => {
    const draftMap: Record<SecretCopyField, string> = {
      password: isEditForm ? editPassword : accPassword,
      recoveryKey: isEditForm ? editRecoveryKey : accRecoveryKey,
      cardNumber,
      cardCvv,
      cardPin,
    };
    const hasExistingMap: Record<SecretCopyField, boolean> = {
      password: Boolean(editingAccount?.has_password),
      recoveryKey: Boolean(editingAccount?.has_recovery_key),
      cardNumber: Boolean(editingAccount?.has_password),
      cardCvv: Boolean(editingAccount?.has_recovery_key),
      cardPin: Boolean(editingAccount?.has_pin),
    };
    const pendingRemovalMap: Record<SecretCopyField, boolean> = {
      password: false,
      recoveryKey: clearRecoveryKey,
      cardNumber: false,
      cardCvv: clearRecoveryKey,
      cardPin: clearCardPin,
    };

    return {
      field,
      isEdit: isEditForm,
      serviceId: selectedServiceId,
      accountId: editingAccount?.id,
      hasExistingSecret: hasExistingMap[field],
      draftValue: draftMap[field],
      markedForRemoval: isEditForm && pendingRemovalMap[field],
    };
  };

  // Copies secret fields directly through the backend without preloading or changing reveal state
  const handleCopyFormSecretField = async (
    isEditForm: boolean,
    field: SecretCopyField
  ) => {
    try {
      const result = await executeSecretCopy(
        getFormSecretCopyTarget(isEditForm, field),
        invoke
      );
      if (result.copied) {
        triggerCopiedIndicator(`${isEditForm ? "edit" : "add"}_${field}`);
      }
    } catch (err: any) {
      const msg = err?.toString() || "فشل نسخ القيمة السرية";
      if (isEditForm) {
        setEditAccountError(msg);
      } else {
        setAddAccountError(msg);
      }
    }
  };

  const formCopyHandler = (
    isEditForm: boolean,
    field: SecretCopyField
  ): (() => void) | undefined =>
    canCopySecretField(getFormSecretCopyTarget(isEditForm, field))
      ? () => void handleCopyFormSecretField(isEditForm, field)
      : undefined;

  // Universal Field Copy Handler (direct zero-leak Rust secure clipboard when available)
  const copyFieldValue = async (accountId: string, field: string, value?: string | null) => {
    try {
      if (field === "password" || field === "number") {
        if (selectedServiceId) {
          await invoke("copy_password", { serviceId: selectedServiceId, accountId });
        } else if (value) {
          await invoke("copy_secure_text", { text: value });
        }
      } else if (field === "recovery_key" || field === "cvv") {
        if (selectedServiceId) {
          await invoke("copy_account_recovery_key", { serviceId: selectedServiceId, accountId });
        } else if (value) {
          await invoke("copy_secure_text", { text: value });
        }
      } else if (field === "pin") {
        if (selectedServiceId) {
          await invoke("copy_account_pin", { serviceId: selectedServiceId, accountId });
        } else if (value) {
          await invoke("copy_secure_text", { text: value });
        }
      } else {
        if (value) await navigator.clipboard.writeText(value);
      }
      triggerCopiedIndicator(`${accountId}_${field}`);
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
      triggerCopiedIndicator(`${accountId}_password`);
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
            alt="Kinana"
            className="h-20 w-auto object-contain mx-auto animate-pulse drop-shadow-lg"
          />
          <div className="flex items-center justify-center gap-3 text-lg font-medium">
            <RefreshCw className="w-5 h-5 animate-spin text-primary" />
            <span>جاري فتح Kinana والتحقق من الأمان...</span>
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

      {/* Floating Centered Toast Notification (Success, Warning, Error) */}
      {notification && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] w-full max-w-lg px-4 pointer-events-auto animate-in fade-in slide-in-from-top-4 duration-300">
          <div
            className={cn(
              "backdrop-blur-xl border-2 rounded-2xl shadow-2xl p-4 flex items-start justify-between gap-3 text-right",
              notification.type === "success" && "bg-emerald-500/15 border-emerald-500/40 text-emerald-100",
              notification.type === "warning" && "bg-amber-500/15 border-amber-500/40 text-amber-100",
              notification.type === "error" && "bg-destructive/15 border-destructive/40 text-destructive-foreground"
            )}
          >
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="shrink-0 mt-0.5">
                {notification.type === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                {notification.type === "warning" && <AlertTriangle className="w-5 h-5 text-amber-400" />}
                {notification.type === "error" && <ShieldAlert className="w-5 h-5 text-destructive" />}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-bold leading-normal [overflow-wrap:anywhere] break-words">
                  {notification.message}
                </p>
                {notification.detail && (
                  <p
                    className="text-xs font-mono opacity-85 mt-1 [overflow-wrap:anywhere] break-all max-h-24 overflow-y-auto bg-black/20 p-2 rounded-lg border border-white/10 text-left ltr"
                    dir="ltr"
                  >
                    {notification.detail}
                  </p>
                )}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dismissNotification()}
              className="hover:bg-white/10 rounded-xl h-8 w-8 p-0 shrink-0 rtl:mr-2 ltr:ml-2"
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
              <div className="flex justify-center mb-5">
                <img
                  src={kinanaLogo}
                  alt="Kinana"
                  className="h-28 sm:h-32 w-auto object-contain drop-shadow-xl"
                />
              </div>
              <CardDescription className="text-lg text-muted-foreground font-medium pt-3 font-sans leading-relaxed">
                خزنة كلمات المرور الآمنة والمشفرة محلياً بالكامل
              </CardDescription>
            </CardHeader>

            <CardContent className="px-6 sm:px-10 pb-8 pt-2">
              {!exists ? (() => {
                const createValidation = validateMasterPasswordForm({
                  password,
                  confirmPassword: confirmCreatePassword,
                  confirmTouched: createConfirmTouched,
                  isSubmitting: isCreatingVault,
                });
                return (
                <form onSubmit={handleCreate} autoComplete="off" className="space-y-4">
                  <div>
                    <FormLabel htmlFor="create-vault-password" required className="mb-2">
                      كلمة المرور الرئيسية
                    </FormLabel>
                    <SecretInput
                      id="create-vault-password"
                      buttonSize="lg"
                      revealed={showCreatePassword}
                      onToggleReveal={() => setShowCreatePassword((prev) => !prev)}
                      revealLabel="إظهار كلمة المرور الرئيسية"
                      hideLabel="إخفاء كلمة المرور الرئيسية"
                      placeholder=""
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="text-lg rounded-2xl border-2"
                      autoFocus
                      required
                    />
                    <PasswordStrengthIndicator password={password} className="mt-2" />
                  </div>

                  <div>
                    <FormLabel htmlFor="create-vault-confirm-password" required className="mb-2">
                      تأكيد كلمة المرور الرئيسية
                    </FormLabel>
                    <SecretInput
                      id="create-vault-confirm-password"
                      buttonSize="lg"
                      revealed={showConfirmCreatePassword}
                      onToggleReveal={() => setShowConfirmCreatePassword((prev) => !prev)}
                      revealLabel="إظهار تأكيد كلمة المرور الرئيسية"
                      hideLabel="إخفاء تأكيد كلمة المرور الرئيسية"
                      placeholder=""
                      value={confirmCreatePassword}
                      onChange={(e) => {
                        if (!createConfirmTouched) setCreateConfirmTouched(true);
                        setConfirmCreatePassword(e.target.value);
                      }}
                      className="text-lg rounded-2xl border-2"
                      required
                    />
                    {createValidation.showMismatchError && (
                      <p role="alert" className="text-sm font-bold text-rose-400 pt-1.5 text-start">
                        كلمتا المرور غير متطابقتين
                      </p>
                    )}
                  </div>

                  <div className="p-4 rounded-2xl bg-muted/40 border border-border/50 text-sm text-muted-foreground leading-relaxed flex items-start gap-3 text-start">
                    <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                    <span>
                      احتفظ بكلمة المرور الرئيسية ومفتاح الاسترداد في مكان آمن. إذا فقدتهما معاً، فلن تتمكن من استعادة الوصول إلى خزنتك.
                    </span>
                  </div>

                  <Button
                    type="submit"
                    disabled={!createValidation.canSubmit}
                    className="w-full min-h-14 text-lg font-bold shadow-xl rounded-2xl"
                  >
                    <span>إنشاء الخزنة</span>
                  </Button>

                  <p className="text-xs text-muted-foreground text-center pt-0.5 leading-relaxed">
                    لم يتم العثور على خزنة سابقة على هذا الجهاز
                  </p>

                  <div className="pt-4 border-t border-border/40">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleOpenImportModal}
                      className="w-full min-h-12 text-sm font-semibold rounded-2xl gap-2 border-border/70"
                    >
                      <Upload className="w-4 h-4 shrink-0" />
                      <span>
                        هل لديك نسخة سابقة؟ استيراد الخزنة (<bdi dir="ltr">.dat</bdi>)
                      </span>
                    </Button>
                  </div>
                </form>
                );
              })() : (
                <form onSubmit={handleUnlock} autoComplete="off" className="space-y-6">
                  <div>
                    <FormLabel htmlFor="unlock-vault-password" centered required className="mb-2.5">
                      أدخل رمز الدخول أو كلمة المرور الرئيسية
                    </FormLabel>
                    <SecretInput
                      id="unlock-vault-password"
                      buttonSize="lg"
                      centered
                      revealed={showUnlockPassword}
                      onToggleReveal={() => setShowUnlockPassword(!showUnlockPassword)}
                      revealLabel="إظهار الرمز"
                      hideLabel="إخفاء الرمز"
                      filledTrackingClass="tracking-widest"
                      placeholder="••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="text-2xl rounded-2xl border-2"
                      autoFocus
                      required
                    />
                  </div>

                  <div className="space-y-3.5 pt-2">
                    <Button
                      type="submit"
                      className="w-full h-16 text-xl font-bold shadow-xl rounded-2xl gap-2.5"
                    >
                      <Unlock className="w-6 h-6" />
                      <span>فتح الخزنة</span>
                    </Button>

                    {autoUnlockActive && isAutoUnlockSupported && (
                      <Button
                        type="button"
                        variant="secondary"
                        className="w-full h-14 text-base font-semibold rounded-2xl gap-2 border border-border/60"
                        onClick={async () => {
                          try {
                            const ok = await unlockWithAutoUnlock(
                              sessionGuardRef.current,
                              invoke,
                              async () => {
                                await fetchSummary();
                              }
                            );
                            if (!ok) {
                              setError("فشل الفتح التلقائي: لم يتم العثور على رمز دخول محفوظ");
                            }
                          } catch (e: any) {
                            const errStr = e?.toString() || "";
                            if (errStr.includes("No saved credential")) {
                              setError("لم يتم العثور على رمز دخول محفوظ في مخزن النظام الآمن. يرجى إدخال الرمز يدوياً.");
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
                      onClick={handleOpenImportModal}
                      className="text-xs font-semibold text-muted-foreground hover:text-primary inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-primary" />
                      <span>استيراد أو تبديل الخزنة من ملف (<bdi dir="ltr">.dat</bdi>)</span>
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
                  alt="Kinana"
                  className="h-10 w-auto object-contain cursor-pointer drop-shadow-sm"
                  title="Kinana"
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
              <div className="flex items-center gap-2 shrink-0">
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
                  onClick={handleOpenImportModal}
                  className="h-10 w-10 rounded-xl border-border/80 shadow-sm text-white hover:text-white hover:bg-muted transition-colors"
                  title="استيراد خزنة من ملف (.dat)"
                >
                  <Upload className="w-4 h-4 text-white" />
                </Button>

                {/* Open Vault Folder */}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleOpenVaultFolder}
                  className="h-10 w-10 rounded-xl border-border/80 shadow-sm text-white hover:text-white hover:bg-muted transition-colors"
                  title="فتح مجلد الخزنة"
                >
                  <FolderOpen className="w-4 h-4 text-white" />
                </Button>

                {/* Settings & Master Password Change */}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    setSettingsFeedback(null);
                    dismissPasswordChangeFeedback();
                    dismissExportImportStatus();
                    setShowVaultRecoveryKey(false);
                    setRecoveryKey(null);
                    setCopiedRecoveryKey(false);
                    setShowSettings(true);
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

          {/* Main Services View: Zoom scales grid tracks, cards, icons, and typography proportionally without CSS zoom bugs */}
          <main
            style={{
              "--vault-zoom": zoomLevel,
              maxWidth: zoomMetrics.containerMaxWidthCss,
              padding: `${zoomMetrics.mainPaddingPx}px`,
            } as React.CSSProperties}
            className="flex-1 mx-auto w-full min-h-[calc(100vh-80px)] select-none"
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
              <div
                style={{
                  gridTemplateColumns: zoomMetrics.gridTemplateColumnsCss,
                  gap: `${zoomMetrics.gridGapPx}px`,
                }}
                className="grid w-full"
              >
                {displayedServices.map((service) => (
                  <ContextMenu key={service.id}>
                    <ContextMenuTrigger asChild>
                      <Card
                        data-service-id={service.id}
                        role="button"
                        tabIndex={0}
                        aria-label={
                          selectionMode
                            ? `${service.name} (${selectedServiceIds.includes(service.id) ? "محددة" : "غير محددة"})`
                            : service.name
                        }
                        onPointerDown={(e) => handlePointerDown(e, service.id)}
                        onClick={() => handleCardClick(service.id)}
                        onKeyDown={(e) => {
                          if (shouldActivateServiceCard(e)) {
                            if (e.key === " ") e.preventDefault();
                            handleCardClick(service.id);
                          }
                        }}
                        className={`kinana-service-card group cursor-grab active:cursor-grabbing border-2 transition-all duration-200 bg-card rounded-2xl overflow-hidden relative aspect-video flex flex-col justify-end shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
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
                            className="kinana-card-badge-pos kinana-card-pin absolute z-20 bg-black/80 text-white rounded-xl border border-white/20 shadow-md flex items-center justify-center pointer-events-none"
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
                            className="kinana-card-badge-pos kinana-card-select absolute z-30 transition-transform active:scale-90"
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

                        {/* Cover Background: Ambient glow backdrop + object-contain foreground */}
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
                              className="kinana-card-logo relative z-0 w-full h-full object-contain group-hover:scale-105 transition-transform duration-500 drop-shadow-md pointer-events-none select-none"
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
                            <span className="kinana-card-monogram relative font-black text-white/90 font-thamaniah drop-shadow-2xl select-none pointer-events-none">
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
                          className={`kinana-card-titlebar relative z-10 w-full flex items-center min-w-0 transition-opacity duration-300 pointer-events-none select-none ${
                            showCardTitles ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                          }`}
                        >
                          <h4
                            dir="auto"
                            className="kinana-card-title font-black font-thamaniah text-white drop-shadow-lg truncate min-w-0 w-full text-start pointer-events-none select-none"
                          >
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
              /* Option 2: Compact List View with Scaled Icons, Labels & Action Buttons */
              <div
                style={{
                  gap: `${zoomMetrics.listRowGapPx}px`,
                  maxWidth:
                    zoomLevel > 1
                      ? `min(100%, ${(64 * zoomLevel).toFixed(2)}rem)`
                      : "64rem",
                }}
                className="flex flex-col mx-auto w-full"
              >
                {displayedServices.map((service) => (
                  <ContextMenu key={service.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        data-service-id={service.id}
                        role="button"
                        tabIndex={0}
                        aria-label={
                          selectionMode
                            ? `${service.name} (${selectedServiceIds.includes(service.id) ? "محددة" : "غير محددة"})`
                            : service.name
                        }
                        onPointerDown={(e) => handlePointerDown(e, service.id)}
                        onClick={() => handleCardClick(service.id)}
                        onKeyDown={(e) => {
                          if (shouldActivateServiceCard(e)) {
                            if (e.key === " ") e.preventDefault();
                            handleCardClick(service.id);
                          }
                        }}
                        style={{
                          padding: `${zoomMetrics.listRowPaddingY}px ${zoomMetrics.listRowPaddingX}px`,
                        }}
                        className={`group cursor-grab active:cursor-grabbing rounded-2xl border-2 bg-card hover:bg-muted/20 transition-all duration-200 hover:shadow-lg flex items-center justify-between gap-4 sm:gap-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                          draggedServiceId === service.id
                            ? "opacity-30 scale-[0.98] border-dashed border-primary ring-4 ring-primary/40 shadow-2xl"
                            : selectionMode && selectedServiceIds.includes(service.id)
                            ? "border-primary ring-2 ring-primary/60 bg-primary/10 shadow-md"
                            : "border-border/70 hover:border-primary/80"
                        }`}
                      >
                        <div className="flex items-center gap-4 sm:gap-5 min-w-0 flex-1 pointer-events-none select-none">
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
                            <div
                              style={{
                                width: `${zoomMetrics.listIconSizePx}px`,
                                height: `${zoomMetrics.listIconSizePx}px`,
                              }}
                              className="rounded-xl overflow-hidden p-1.5 bg-zinc-950/80 border border-border/50 shrink-0 shadow-sm group-hover:scale-105 transition-transform flex items-center justify-center pointer-events-none"
                            >
                              <img
                                src={service.icon_data}
                                alt={service.name}
                                draggable={false}
                                className="w-full h-full object-contain rounded-lg pointer-events-none select-none"
                              />
                            </div>
                          ) : (
                            <div
                              style={{
                                width: `${zoomMetrics.listIconSizePx}px`,
                                height: `${zoomMetrics.listIconSizePx}px`,
                                fontSize: `${Math.max(1.1, zoomMetrics.listTitleFontRem)}rem`,
                              }}
                              className={`rounded-xl bg-gradient-to-br ${getServiceGradient(
                                service.name
                              )} flex items-center justify-center text-white font-black font-thamaniah shrink-0 shadow-sm group-hover:scale-105 transition-transform pointer-events-none`}
                            >
                              {service.name.charAt(0).toUpperCase()}
                            </div>
                          )}

                          <div className="min-w-0 flex-1 pointer-events-none">
                            <div className="flex items-center gap-2 min-w-0">
                              <h4
                                dir="auto"
                                style={{ fontSize: `${zoomMetrics.listTitleFontRem}rem` }}
                                className="font-bold font-thamaniah text-foreground group-hover:text-primary transition-colors truncate min-w-0 text-start pointer-events-none leading-relaxed py-0.5"
                              >
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
                            <span
                              style={{ fontSize: `${zoomMetrics.listSubtitleFontRem}rem` }}
                              className="text-muted-foreground font-medium pointer-events-none block truncate text-start"
                            >
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
          <DestructiveConfirmDialog
            open={showBatchDeleteModal}
            onOpenChange={setShowBatchDeleteModal}
            title={
              selectedServiceIds.length === 1
                ? "تأكيد حذف الخدمة المحددة"
                : "تأكيد حذف الخدمات المحددة"
            }
            description={
              <>
                أنت على وشك حذف{" "}
                <strong className="text-foreground">{selectedServiceIds.length}</strong>{" "}
                {selectedServiceIds.length === 1 ? "خدمة" : "خدمات"} مع كافة الحسابات وكلمات المرور والبيانات المحفوظة داخلها نهائياً. لا يمكن التراجع عن هذا الإجراء.
              </>
            }
            confirmLabel={
              selectedServiceIds.length === 1
                ? "حذف الخدمة"
                : `حذف المحدد (${selectedServiceIds.length})`
            }
            isSubmitting={isDeleting}
            onCancel={() => setShowBatchDeleteModal(false)}
            onConfirm={handleConfirmBatchDelete}
          />
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
          <span>تصدير نسخة الخزنة (<bdi dir="ltr">.dat</bdi>)</span>
          <Download className="w-4 h-4 text-white" />
        </ContextMenuItem>
        <ContextMenuItem
          onClick={handleOpenImportModal}
          disabled={isProcessingBackup}
          className="flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer hover:bg-muted transition-colors text-foreground gap-2"
        >
          <span>استيراد نسخة خزنة (<bdi dir="ltr">.dat</bdi>)</span>
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
        <DialogContent className="max-w-4xl p-6 sm:p-8 rounded-3xl bg-card border-2 border-border/80 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
          {selectedService && (
            <div className="flex flex-col flex-1 min-h-0 space-y-6">
              {/* Service Header Info */}
              <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-border/70 shrink-0 rtl:pl-8 ltr:pr-8">
                <div className="flex items-center gap-5 min-w-0">
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
                  <div className="min-w-0 text-start">
                    <DialogTitle
                      dir="auto"
                      className="text-3xl font-black font-thamaniah text-foreground truncate text-start leading-relaxed py-0.5"
                    >
                      {selectedService.name}
                    </DialogTitle>
                    <DialogDescription className="text-sm font-semibold text-muted-foreground mt-1 text-start">
                      {serviceAccounts.length} حساب مسجل
                    </DialogDescription>
                  </div>
                </div>

                {/* Service Header Actions */}
                <div className="flex items-center gap-3 shrink-0">
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
                      resetAccountFormFields();
                      setAddAccountError(null);
                      const isCard = isBankOrCardService(selectedService?.name);
                      setAccountFormMode(isCard ? "card" : "login");
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

              {/* Accounts List (Single scroll container without nested backdrop-blur or CSS blur-3xl layers) */}
              <div className="space-y-5 flex-1 min-h-0 overflow-y-auto px-1 pb-1">
                {loadingAccounts ? (
                  <div className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin text-primary" />
                    <span>جاري تحميل بيانات الحسابات...</span>
                  </div>
                ) : serviceAccounts.length === 0 ? (
                  <div className="text-center py-14 bg-muted/20 rounded-2xl border-2 border-dashed border-border/60">
                    <Button
                      onClick={() => {
                        resetAccountFormFields();
                        setAddAccountError(null);
                        const isCard = isBankOrCardService(selectedService?.name);
                        setAccountFormMode(isCard ? "card" : "login");
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
                    const isCard = isAccountCard(acc);

                    if (isCard) {
                      const brand = detectCardBrand(acc.username, selectedService?.name);
                      const cleanNotes = extractCleanCardNotes(acc.notes);
                      const isCvvRevealed = revealedCardCvvs[acc.id] || false;
                      const isPinRevealed = revealedCardPins[acc.id] || false;

                      return (
                        <div
                          key={acc.id}
                          className="relative rounded-3xl p-6 sm:p-7 shadow-xl border-2 border-border/80 overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white space-y-4"
                        >
                          {/* Lightweight gradient ambient glows (replaces heavy blur-3xl filters that trigger WebKitGTK tile glitches) */}
                          <div
                            aria-hidden="true"
                            className="absolute inset-0 pointer-events-none"
                            style={{
                              background:
                                "radial-gradient(circle at 88% 12%, rgba(99, 102, 241, 0.22), transparent 46%), radial-gradient(circle at 12% 88%, rgba(79, 70, 229, 0.16), transparent 46%)",
                            }}
                          />

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
                              <span className="text-xl font-bold font-thamaniah text-white pr-1 truncate leading-relaxed py-0.5">
                                {acc.label || "بطاقة دفع"}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <Badge className="px-3.5 py-1 text-xs font-black tracking-widest bg-white/15 text-white border border-white/20 rounded-xl" dir="ltr">
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
                                    isCard: true,
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
                          <div className="relative z-10 my-4 bg-black/45 p-4 rounded-2xl border border-white/10 flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0 text-start">
                              <span className="text-[11px] tracking-normal text-slate-400 font-bold block mb-1">
                                رقم البطاقة (<bdi dir="ltr">Card Number</bdi>)
                              </span>
                              <div className="font-mono text-xl sm:text-2xl font-bold tracking-[0.22em] text-white text-start" dir="ltr">
                                {!acc.has_password
                                  ? "—"
                                  : revealedAccountPasswords[acc.id] && acc.password
                                  ? acc.password.replace(/(.{4})/g, "$1 ").trim()
                                  : "•••• •••• •••• ••••"}
                              </div>
                            </div>
                            {acc.has_password && (
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
                            )}
                          </div>

                          {/* Bottom Info Grid: Cardholder, Expiry, CVV, PIN */}
                          <div className="relative z-10 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                            {/* Cardholder */}
                            <div className="bg-black/30 p-3 rounded-xl border border-white/10 flex items-center justify-between">
                              <div className="min-w-0 pe-1 flex-1 text-start">
                                <span className="text-[10px] tracking-normal text-slate-400 font-bold block mb-0.5">
                                  حامل البطاقة
                                </span>
                                <span dir="auto" className="font-sans font-bold text-white tracking-normal block truncate uppercase leading-relaxed py-0.5">
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
                            <div className="bg-black/30 p-3 rounded-xl border border-white/10 flex items-center justify-between">
                              <div className="text-start">
                                <span className="text-[10px] tracking-normal text-slate-400 font-bold block mb-0.5">
                                  تنتهي في
                                </span>
                                <span dir="ltr" className="font-mono font-bold text-white block">
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
                            <div className="bg-black/30 p-3 rounded-xl border border-white/10 flex items-center justify-between">
                              <div className="text-start">
                                <span className="text-[10px] tracking-normal text-slate-400 font-bold block mb-0.5">
                                  رمز الأمان <bdi dir="ltr">CVV</bdi>
                                </span>
                                <span dir="ltr" className="font-mono font-bold text-amber-300 block">
                                  {isCvvRevealed ? (acc.recovery_key || "•••") : (acc.has_recovery_key ? "•••" : "—")}
                                </span>
                              </div>
                              {acc.has_recovery_key && (
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => toggleRevealCardCvv(selectedService.id, acc)}
                                    className="h-7 w-7 p-0 text-slate-400 hover:text-white"
                                    title={isCvvRevealed ? "إخفاء" : "إظهار"}
                                  >
                                    {isCvvRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => copyFieldValue(acc.id, "cvv")}
                                    className="h-7 w-7 p-0 text-slate-400 hover:text-white"
                                    title="نسخ CVV"
                                  >
                                    {copiedKey === `${acc.id}_cvv` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                  </Button>
                                </div>
                              )}
                            </div>

                            {/* PIN */}
                            {acc.has_pin ? (
                              <div className="bg-black/30 p-3 rounded-xl border border-white/10 flex items-center justify-between">
                                <div className="text-start">
                                  <span className="text-[10px] tracking-normal text-slate-400 font-bold block mb-0.5">
                                    الرمز السري <bdi dir="ltr">PIN</bdi>
                                  </span>
                                  <span dir="ltr" className="font-mono font-bold text-emerald-400 block">
                                    {isPinRevealed ? (revealedCardPinValues[acc.id] || "••••") : "••••"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => toggleRevealCardPin(selectedService.id, acc)}
                                    className="h-7 w-7 p-0 text-slate-400 hover:text-white"
                                    title={isPinRevealed ? "إخفاء" : "إظهار"}
                                  >
                                    {isPinRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => copyFieldValue(acc.id, "pin")}
                                    className="h-7 w-7 p-0 text-slate-400 hover:text-white"
                                    title="نسخ PIN"
                                  >
                                    {copiedKey === `${acc.id}_pin` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="bg-black/30 p-3 rounded-xl border border-white/10 text-start">
                                <span className="text-[10px] tracking-normal text-slate-400 font-bold block mb-0.5">
                                  حالة الحماية
                                </span>
                                <span className="font-sans font-bold text-emerald-400 text-xs block">
                                  مشفرة ومؤمنة
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Extra Notes */}
                          {cleanNotes && (
                            <div className="relative z-10 pt-3 border-t border-white/10 text-xs text-slate-300 flex items-center justify-between">
                              <span dir="auto" className="truncate pe-2 text-start leading-relaxed py-0.5"><strong className="text-slate-400">ملاحظات:</strong> {cleanNotes}</span>
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
                      className="p-6 rounded-2xl border-2 border-border/70 bg-card shadow-sm space-y-4 hover:border-primary/50 transition-colors"
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
                                isCard: false,
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
                              <span className="font-sans font-bold text-base text-foreground truncate block select-all leading-relaxed py-0.5">
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
                              <span className="font-sans font-bold text-base text-foreground truncate block select-all leading-relaxed py-0.5">
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
                        {acc.has_recovery_key && (
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
                                  ? (acc.recovery_key || "••••••••••••••••")
                                  : "••••••••••••••••"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={() => selectedService && toggleRevealAccountRecoveryKey(selectedService.id, acc)}
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
                                onClick={() => copyFieldValue(acc.id, "recovery_key")}
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
                            <div className="min-w-0 pe-2 flex-1 text-start">
                              <span className="text-xs font-bold text-muted-foreground block mb-0.5">
                                رابط تسجيل الدخول (<bdi dir="ltr">URL</bdi>)
                              </span>
                              <button
                                type="button"
                                dir="ltr"
                                onClick={() => handleOpenUrl(acc.url)}
                                className="text-primary hover:underline text-sm font-semibold truncate block max-w-full text-start cursor-pointer bg-transparent border-0 p-0"
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
                            <div className="min-w-0 pe-2 flex-1 text-start">
                              <span className="text-xs font-bold text-muted-foreground block mb-1">
                                ملاحظات
                              </span>
                              <p
                                dir="auto"
                                className="text-sm font-medium text-foreground/90 whitespace-pre-wrap leading-relaxed select-all text-start [overflow-wrap:anywhere]"
                              >
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

          <form onSubmit={handleAddService} autoComplete="off" className="space-y-6 pt-2">
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
                    className="min-h-10 text-xs pr-9 pl-8 rounded-xl bg-card/80 border-border/70"
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
              <FormLabel htmlFor="add-service-name" required className="mb-2">
                اسم الخدمة
              </FormLabel>
              <Input
                id="add-service-name"
                placeholder="مثال: Google, Netflix, Steam, منصة أبشر..."
                value={newServiceName}
                onChange={(e) => setNewServiceName(e.target.value)}
                className="min-h-14 text-lg px-4 font-sans font-bold rounded-xl border-2"
                autoFocus
                required
                aria-required="true"
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
                className="h-12 px-6 rounded-xl text-base font-bold"
              >
                إلغاء
              </Button>
              <Button type="submit" className="h-12 px-8 rounded-xl text-base font-bold shadow-lg">
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

          <form onSubmit={handleUpdateService} autoComplete="off" className="space-y-6 pt-2">
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
                    className="min-h-10 text-xs pr-9 pl-8 rounded-xl bg-card/80 border-border/70"
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
              <FormLabel htmlFor="edit-service-name" required className="mb-2">
                اسم الخدمة
              </FormLabel>
              <Input
                id="edit-service-name"
                value={editServiceName}
                onChange={(e) => setEditServiceName(e.target.value)}
                className="min-h-14 text-lg px-4 font-sans font-bold rounded-xl border-2"
                required
                aria-required="true"
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
                className="h-12 px-6 rounded-xl text-base font-bold"
              >
                إلغاء
              </Button>
              <Button type="submit" className="h-12 px-8 rounded-xl text-base font-bold shadow-lg">
                حفظ التعديلات
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ================= MODAL: ADD ACCOUNT (MULTI-FIELD ALL OPTIONAL) ================= */}
      <Dialog
        open={showAddAccount}
        onOpenChange={(open) => {
          if (open) {
            setShowAddAccount(true);
          } else {
            closeAddAccountModal();
          }
        }}
      >
        <DialogContent className="max-w-2xl p-8 rounded-3xl bg-card border-2 border-border/80 shadow-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-3xl font-black font-thamaniah flex items-center gap-3 text-start">
              <Plus className="w-7 h-7 text-primary shrink-0" />
              <span>
                {accountFormMode === "card"
                  ? `إضافة بطاقة جديدة إلى ${selectedService?.name}`
                  : `إضافة حساب جديد إلى ${selectedService?.name}`}
              </span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              نموذج إضافة حساب أو بطاقة جديدة
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

          <form onSubmit={handleAddAccount} autoComplete="off" className="space-y-4 pt-2">
            <AccountFormFields
              mode={accountFormMode}
              isEdit={false}
              idPrefix="add"
              cardPreviewBadge={detectCardBrand(cardNumber, selectedService?.name).badge}
              label={accLabel}
              onLabelChange={setAccLabel}
              notes={accNotes}
              onNotesChange={setAccNotes}
              username={accUsername}
              onUsernameChange={setAccUsername}
              email={accEmail}
              onEmailChange={setAccEmail}
              password={accPassword}
              onPasswordChange={setAccPassword}
              showPassword={showAccPassword}
              onToggleShowPassword={() => setShowAccPassword((prev) => !prev)}
              onGeneratePassword={() => handleGeneratePassword("add")}
              onCopyPassword={formCopyHandler(false, "password")}
              copiedPassword={copiedKey === "add_password"}
              recoveryKey={accRecoveryKey}
              onRecoveryKeyChange={setAccRecoveryKey}
              showRecoveryKey={showAccRecoveryKey}
              onToggleShowRecoveryKey={() => setShowAccRecoveryKey((prev) => !prev)}
              onCopyRecoveryKey={formCopyHandler(false, "recoveryKey")}
              copiedRecoveryKey={copiedKey === "add_recoveryKey"}
              url={accUrl}
              onUrlChange={setAccUrl}
              cardHolder={cardHolder}
              onCardHolderChange={setCardHolder}
              cardNumber={cardNumber}
              onCardNumberChange={setCardNumber}
              showCardNumber={showCardNumber}
              onToggleShowCardNumber={() => setShowCardNumber((prev) => !prev)}
              onCopyCardNumber={formCopyHandler(false, "cardNumber")}
              copiedCardNumber={copiedKey === "add_cardNumber"}
              cardExpiry={cardExpiry}
              onCardExpiryChange={setCardExpiry}
              cardCvv={cardCvv}
              onCardCvvChange={setCardCvv}
              showCardCvv={showCardCvv}
              onToggleShowCardCvv={() => setShowCardCvv((prev) => !prev)}
              onCopyCardCvv={formCopyHandler(false, "cardCvv")}
              copiedCardCvv={copiedKey === "add_cardCvv"}
              cardPin={cardPin}
              onCardPinChange={setCardPin}
              showCardPin={showCardPin}
              onToggleShowCardPin={() => setShowCardPin((prev) => !prev)}
              onCopyCardPin={formCopyHandler(false, "cardPin")}
              copiedCardPin={copiedKey === "add_cardPin"}
            />

            <div className="flex justify-end gap-3 pt-4 border-t border-border/40">
              <Button
                type="button"
                variant="outline"
                disabled={isSavingAccount}
                onClick={closeAddAccountModal}
                className="h-12 px-6 rounded-xl text-base font-bold"
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                disabled={isSavingAccount}
                className="h-12 px-8 rounded-xl text-base font-bold shadow-lg"
              >
                حفظ الحساب
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ================= MODAL: EDIT ACCOUNT ================= */}
      <Dialog
        open={Boolean(editingAccount)}
        onOpenChange={(open) => {
          if (!open) {
            closeEditAccountModal();
          }
        }}
      >
        <DialogContent className="max-w-2xl p-8 rounded-3xl bg-card border-2 border-border/80 shadow-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-3xl font-black font-thamaniah flex items-center gap-3 text-start">
              <Pencil className="w-7 h-7 text-primary shrink-0" />
              <span>{accountFormMode === "card" ? "تعديل بيانات البطاقة" : "تعديل الحساب"}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              نموذج تعديل بيانات الحساب أو البطاقة
            </DialogDescription>
          </DialogHeader>

          {/* Mode Switcher: Login Account vs Bank Card */}
          <div className="flex p-1 bg-muted/60 rounded-2xl border border-border/60 mt-3 mb-2">
            <button
              type="button"
              onClick={() => {
                editSecretControllerRef.current?.hideAll();
                setAccountFormMode("login");
              }}
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
              onClick={() => {
                editSecretControllerRef.current?.hideAll();
                setAccountFormMode("card");
              }}
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

          <form onSubmit={handleUpdateAccount} autoComplete="off" className="space-y-4 pt-2">
            <AccountFormFields
              mode={accountFormMode}
              isEdit
              idPrefix="edit"
              cardPreviewBadge={detectCardBrand(cardNumber, selectedService?.name).badge}
              label={editLabel}
              onLabelChange={setEditLabel}
              notes={editNotes}
              onNotesChange={setEditNotes}
              username={editUsername}
              onUsernameChange={setEditUsername}
              email={editEmail}
              onEmailChange={setEditEmail}
              password={editPassword}
              onPasswordChange={(val) =>
                handleEditSecretDraftChange(
                  "password",
                  val,
                  Boolean(editingAccount?.has_password),
                  setEditPassword
                )
              }
              showPassword={editSecretState.password.revealed}
              onToggleShowPassword={handleToggleEditPasswordReveal}
              onGeneratePassword={() => handleGeneratePassword("edit")}
              recoveryKey={editRecoveryKey}
              onRecoveryKeyChange={(val) =>
                handleEditSecretDraftChange(
                  "recoveryKey",
                  val,
                  Boolean(editingAccount?.has_recovery_key),
                  setEditRecoveryKey
                )
              }
              showRecoveryKey={editSecretState.recoveryKey.revealed}
              onToggleShowRecoveryKey={() => handleToggleEditSecretField("recoveryKey")}
              url={editUrl}
              onUrlChange={setEditUrl}
              cardHolder={cardHolder}
              onCardHolderChange={setCardHolder}
              cardNumber={cardNumber}
              onCardNumberChange={(val) =>
                handleEditSecretDraftChange(
                  "cardNumber",
                  val,
                  Boolean(editingAccount?.has_password),
                  setCardNumber
                )
              }
              showCardNumber={editSecretState.cardNumber.revealed}
              onToggleShowCardNumber={() => handleToggleEditSecretField("cardNumber")}
              cardExpiry={cardExpiry}
              onCardExpiryChange={setCardExpiry}
              cardCvv={cardCvv}
              onCardCvvChange={(val) =>
                handleEditSecretDraftChange(
                  "cardCvv",
                  val,
                  Boolean(editingAccount?.has_recovery_key),
                  setCardCvv
                )
              }
              showCardCvv={editSecretState.cardCvv.revealed}
              onToggleShowCardCvv={() => handleToggleEditSecretField("cardCvv")}
              cardPin={cardPin}
              onCardPinChange={(val) =>
                handleEditSecretDraftChange(
                  "cardPin",
                  val,
                  Boolean(editingAccount?.has_pin),
                  setCardPin
                )
              }
              showCardPin={editSecretState.cardPin.revealed}
              onToggleShowCardPin={() => handleToggleEditSecretField("cardPin")}
              hasExistingPassword={Boolean(editingAccount?.has_password)}
              revealedStoredPassword={editSecretState.password.revealedStoredValue}
              onCopyPassword={formCopyHandler(true, "password")}
              copiedPassword={copiedKey === "edit_password"}
              hasExistingRecoveryKey={Boolean(editingAccount?.has_recovery_key)}
              revealedStoredRecoveryKey={editSecretState.recoveryKey.revealedStoredValue}
              onCopyRecoveryKey={formCopyHandler(true, "recoveryKey")}
              copiedRecoveryKey={copiedKey === "edit_recoveryKey"}
              revealedStoredCardNumber={editSecretState.cardNumber.revealedStoredValue}
              onCopyCardNumber={formCopyHandler(true, "cardNumber")}
              copiedCardNumber={copiedKey === "edit_cardNumber"}
              revealedStoredCardCvv={editSecretState.cardCvv.revealedStoredValue}
              onCopyCardCvv={formCopyHandler(true, "cardCvv")}
              copiedCardCvv={copiedKey === "edit_cardCvv"}
              hasExistingPin={Boolean(editingAccount?.has_pin)}
              revealedStoredCardPin={editSecretState.cardPin.revealedStoredValue}
              onCopyCardPin={formCopyHandler(true, "cardPin")}
              copiedCardPin={copiedKey === "edit_cardPin"}
              clearRecoveryKey={clearRecoveryKey}
              onSetClearRecoveryKey={(clear) => {
                setClearRecoveryKey(clear);
                if (clear) {
                  editSecretControllerRef.current?.hideField("recoveryKey");
                  editSecretControllerRef.current?.hideField("cardCvv");
                }
              }}
              clearCardPin={clearCardPin}
              onSetClearCardPin={(clear) => {
                setClearCardPin(clear);
                if (clear) {
                  editSecretControllerRef.current?.hideField("cardPin");
                }
              }}
            />

            <div className="flex justify-end gap-3 pt-4 border-t border-border/40">
              <Button
                type="button"
                variant="outline"
                disabled={isSavingAccount}
                onClick={closeEditAccountModal}
                className="h-12 px-6 rounded-xl text-base font-bold"
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                disabled={isSavingAccount}
                className="h-12 px-8 rounded-xl text-base font-bold shadow-lg"
              >
                حفظ التعديلات
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ================= MODAL: DELETE CONFIRMATION (STANDARDIZED RTL DESTRUCTIVE DIALOG) ================= */}
      <DestructiveConfirmDialog
        open={Boolean(serviceToDelete || accountToDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setServiceToDelete(null);
            setAccountToDelete(null);
          }
        }}
        title={
          serviceToDelete
            ? "تأكيد حذف الخدمة"
            : accountToDelete?.isCard
            ? "تأكيد حذف البطاقة"
            : "تأكيد حذف الحساب"
        }
        description={
          serviceToDelete ? (
            <>
              هل أنت متأكد من حذف خدمة{" "}
              <span className="font-bold text-foreground">«{serviceToDelete.name}»</span>؟
              <br />
              سيتم حذف هذه الخدمة نهائياً مع كافة الحسابات وكلمات المرور التابعة لها، ولا يمكن التراجع عن هذا الإجراء.
            </>
          ) : accountToDelete?.isCard ? (
            <>
              هل أنت متأكد من حذف بطاقة{" "}
              <span className="font-bold text-foreground">«{accountToDelete.label}»</span>؟
              <br />
              سيتم مسح بيانات البطاقة وأرقامها السرية نهائياً من الخزنة.
            </>
          ) : (
            <>
              هل أنت متأكد من حذف حساب{" "}
              <span className="font-bold text-foreground">«{accountToDelete?.label}»</span>؟
              <br />
              سيتم مسح بيانات الحساب وكلمة المرور الخاصة به نهائياً من الخزنة.
            </>
          )
        }
        confirmLabel={
          serviceToDelete
            ? "حذف الخدمة"
            : accountToDelete?.isCard
            ? "حذف البطاقة"
            : "حذف الحساب"
        }
        isSubmitting={isDeleting}
        onCancel={() => {
          setServiceToDelete(null);
          setAccountToDelete(null);
        }}
        onConfirm={async () => {
          if (serviceToDelete) {
            await confirmDeleteService(serviceToDelete.id);
          } else if (accountToDelete) {
            await confirmDeleteAccount(accountToDelete.serviceId, accountToDelete.accountId);
          }
        }}
      />

      {/* ================= MODAL: SETTINGS & SECURITY ================= */}
      <Dialog
        open={showSettings}
        onOpenChange={(open) => {
          setShowSettings(open);
          if (!open) {
            setShowSavedPassword(false);
            setSavedPasswordHint(null);
            setShowVaultRecoveryKey(false);
            setRecoveryKey(null);
            setCopiedRecoveryKey(false);
            setShowNewMasterPassword(false);
            setShowConfirmMasterPassword(false);
            setNewMasterPassword("");
            setConfirmMasterPassword("");
            setSettingsConfirmTouched(false);
            dismissSettingsFeedback();
            dismissPasswordChangeFeedback();
            dismissExportImportStatus();
          }
        }}
      >
        <DialogContent className="max-w-3xl p-8 rounded-3xl bg-card border-2 border-border/80 shadow-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-3xl font-black font-thamaniah flex items-center gap-3 text-start">
              <Settings className="w-8 h-8 text-white shrink-0" />
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
                  onClick={() => dismissSettingsFeedback()}
                  className="h-8 w-8 p-0 rounded-lg hover:bg-white/10"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}

            {passwordChangeFeedback && (
              <div
                className={`p-4 rounded-2xl border font-semibold text-base flex items-center justify-between gap-3 ${
                  passwordChangeFeedback.type === "warning"
                    ? "bg-amber-500/15 border-amber-500/40 text-amber-200"
                    : "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                }`}
              >
                <div className="flex items-center gap-3">
                  {passwordChangeFeedback.type === "warning" ? (
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                  ) : (
                    <Check className="w-5 h-5 shrink-0" />
                  )}
                  <span>{passwordChangeFeedback.message}</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => dismissPasswordChangeFeedback()}
                  className="h-8 w-8 p-0 rounded-lg hover:bg-white/10"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}

            {/* Section 1: Auto-Unlock Toggle (Supported on Windows and Linux) */}
            {isAutoUnlockSupported && (
              <div className="p-6 rounded-2xl bg-muted/40 border border-border/60 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Shield className="w-6 h-6 text-white shrink-0" />
                    <div>
                      <h4 className="text-lg font-bold text-foreground">
                        الفتح التلقائي (Passwordless by default)
                      </h4>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {autoUnlockActive
                          ? `مفعّل: يتم فتح Kinana تلقائياً عبر مخزن الاعتمادات الآمن (${autoUnlockStatus.platform_name}).`
                          : "معطّل: سيُطلب منك إدخال كلمة المرور الرئيسية في كل مرة تشغّل فيها التطبيق."}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant={autoUnlockActive ? "destructive" : "default"}
                    onClick={handleToggleAutoUnlock}
                    disabled={!autoUnlockStatus.available && !autoUnlockActive}
                    className="rounded-xl font-bold h-11 px-5 shadow-sm shrink-0"
                  >
                    {autoUnlockActive ? "تعطيل الفتح التلقائي" : "تفعيل الفتح التلقائي"}
                  </Button>
                </div>

                {/* Keyring Availability Notice if unavailable on Linux */}
                {!autoUnlockStatus.available && (
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-sm leading-relaxed flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-bold text-amber-300">
                        مخزن المفاتيح الآمن ({autoUnlockStatus.platform_name}) غير متاح حالياً.
                      </p>
                      <p className="text-xs text-amber-200/90 leading-relaxed">
                        {autoUnlockStatus.unavailable_reason ||
                          "يرجى التحقق من تشغيل خدمة إدارة المفاتيح (gnome-keyring أو kwallet) في بيئة سطح المكتب الحالية."}
                      </p>
                    </div>
                  </div>
                )}

                {/* Credential store informational/warning notice */}
                {autoUnlockStatus.available && (
                  <div
                    className={`p-4 rounded-xl text-sm leading-relaxed flex items-start gap-3 border ${
                      autoUnlockActive
                        ? "bg-amber-500/10 border-amber-500/30 text-amber-200"
                        : "bg-muted/40 border-border/50 text-muted-foreground"
                    }`}
                  >
                    <Info
                      className={`w-5 h-5 shrink-0 mt-0.5 ${
                        autoUnlockActive ? "text-amber-400" : "text-muted-foreground"
                      }`}
                    />
                    <div className="space-y-1 text-start">
                      <p
                        className={`font-bold ${
                          autoUnlockActive ? "text-amber-300" : "text-foreground"
                        }`}
                      >
                        {autoUnlockActive
                          ? `تنبيه: يتم حفظ كلمة المرور محلياً في ${autoUnlockStatus.platform_name}.`
                          : `عند تفعيل الفتح التلقائي، يتم حفظ كلمة المرور في ${autoUnlockStatus.platform_name}.`}
                      </p>
                      <p
                        className={`text-xs leading-relaxed ${
                          autoUnlockActive ? "text-amber-200/90" : "text-muted-foreground"
                        }`}
                      >
                        هذا يعني إمكانية قراءة الرمز من أي تطبيق آخر يعمل بنفس حساب المستخدم الحالي على هذا الجهاز.
                        إذا كنت تفضل أعلى درجات الحماية والعزل، اترك الفتح التلقائي معطلاً.
                      </p>
                    </div>
                  </div>
                )}

                {/* Reveal current password if available */}
                {autoUnlockActive && (
                  <div className="pt-3 border-t border-border/40 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">الرمز المحفوظ حالياً في مخزن النظام:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-sans font-bold bg-background px-3 py-1 rounded-lg border border-border">
                        {showSavedPassword && savedPasswordHint ? savedPasswordHint : "••••••••••••"}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          if (showSavedPassword) {
                            setShowSavedPassword(false);
                            setSavedPasswordHint(null);
                          } else {
                            try {
                              const saved = await invoke<string>("get_current_saved_password");
                              setSavedPasswordHint(saved);
                              setShowSavedPassword(true);
                            } catch {
                              setSavedPasswordHint(null);
                              setShowSavedPassword(false);
                            }
                          }
                        }}
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
            )}

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
                    className="min-h-10 text-xs font-bold rounded-xl border-border/70"
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
                  <span className="text-xs font-semibold text-emerald-400 ms-auto">
                    الحالي: {Math.round(autoLockTimeout / 60)} دقيقة
                  </span>
                )}
                {autoLockTimeout === null && (
                  <span className="text-xs font-semibold text-amber-300 ms-auto">
                    الحالي: معطل بالكامل (أبداً)
                  </span>
                )}
              </div>
            </div>
            <div className="p-6 rounded-2xl bg-muted/40 border border-border/60 space-y-5">
              <div className="flex items-center gap-3">
                <Key className="w-6 h-6 text-white shrink-0" />
                <h4 className="text-lg font-bold text-foreground">
                  تغيير كلمة المرور الرئيسية
                </h4>
              </div>

              {(() => {
                const settingsPwValidation = validateMasterPasswordForm({
                  password: newMasterPassword,
                  confirmPassword: confirmMasterPassword,
                  confirmTouched: settingsConfirmTouched,
                  isSubmitting: isChangingMasterPassword,
                });
                return (
              <form onSubmit={handleChangeMasterPassword} autoComplete="off" className="space-y-4">
                <div>
                  <FormLabel htmlFor="settings-new-password" required className="text-sm">
                    كلمة المرور الرئيسية الجديدة
                  </FormLabel>
                  <SecretInput
                    id="settings-new-password"
                    revealed={showNewMasterPassword}
                    onToggleReveal={() => setShowNewMasterPassword((prev) => !prev)}
                    revealLabel="إظهار كلمة المرور الجديدة"
                    hideLabel="إخفاء كلمة المرور الجديدة"
                    placeholder=""
                    value={newMasterPassword}
                    onChange={(e) => setNewMasterPassword(e.target.value)}
                    className="text-base font-bold rounded-xl border-2"
                    required
                  />
                  <PasswordStrengthIndicator password={newMasterPassword} className="mt-2" />
                </div>

                <div>
                  <FormLabel htmlFor="settings-confirm-password" required className="text-sm">
                    تأكيد كلمة المرور الرئيسية
                  </FormLabel>
                  <SecretInput
                    id="settings-confirm-password"
                    revealed={showConfirmMasterPassword}
                    onToggleReveal={() => setShowConfirmMasterPassword((prev) => !prev)}
                    revealLabel="إظهار تأكيد كلمة المرور"
                    hideLabel="إخفاء تأكيد كلمة المرور"
                    placeholder=""
                    value={confirmMasterPassword}
                    onChange={(e) => {
                      if (!settingsConfirmTouched) setSettingsConfirmTouched(true);
                      setConfirmMasterPassword(e.target.value);
                    }}
                    className="text-base font-bold rounded-xl border-2"
                    required
                  />
                  {settingsPwValidation.showMismatchError && (
                    <p role="alert" className="text-sm font-bold text-rose-400 pt-1.5 text-start">
                      كلمتا المرور غير متطابقتين
                    </p>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    disabled={!settingsPwValidation.canSubmit}
                    className="min-h-12 px-6 rounded-xl font-bold shadow-md"
                  >
                    <span>حفظ كلمة المرور الجديدة</span>
                  </Button>
                </div>
              </form>
                );
              })()}
            </div>

            {/* Section 3: Emergency Recovery Key */}
            <div className="p-6 rounded-2xl bg-muted/40 border border-border/60 space-y-4">
              <div className="flex items-start gap-3">
                <KeyRound className="w-6 h-6 text-white shrink-0 mt-0.5" />
                <div className="min-w-0 text-start">
                  <h4 className="text-lg font-bold text-foreground">
                    مفتاح استرداد الطوارئ (<bdi dir="ltr">Emergency Recovery Key</bdi>)
                  </h4>
                  <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
                    احفظ هذا المفتاح في مكان آمن. يتيح لك استعادة كامل الخزنة في حال نسيت رمز الدخول. يبقى مخفيًا افتراضيًا ويمكنك إظهاره أو نسخه بأمان.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 bg-background p-3.5 sm:p-4 rounded-2xl border-2 border-primary/40 shadow-inner">
                <div
                  dir="ltr"
                  className={`flex-1 min-w-[200px] font-mono text-lg sm:text-xl font-bold tracking-widest text-center break-all ${
                    showVaultRecoveryKey && recoveryKey
                      ? "text-primary select-all"
                      : "text-muted-foreground select-none"
                  }`}
                >
                  {getVisibleRecoveryKeyText({
                    value: recoveryKey,
                    revealed: showVaultRecoveryKey,
                  })}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleToggleVaultRecoveryKey}
                    aria-label={showVaultRecoveryKey ? "إخفاء مفتاح الطوارئ" : "إظهار مفتاح الطوارئ"}
                    aria-pressed={showVaultRecoveryKey}
                    title={showVaultRecoveryKey ? "إخفاء مفتاح الطوارئ" : "إظهار مفتاح الطوارئ"}
                    className="h-11 w-11 p-0 rounded-xl shrink-0"
                  >
                    {showVaultRecoveryKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleCopyVaultRecoveryKey}
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
              </div>
            </div>

            {/* Section 4: Vault Backup & Migration (Export / Import between PC and Laptop) */}
            <div className="p-6 rounded-2xl bg-muted/40 border border-border/60 space-y-4">
              <div className="flex items-center gap-3">
                <FolderSync className="w-6 h-6 text-white" />
                <div>
                  <h4 className="text-lg font-bold text-foreground">
                    النسخ الاحتياطي ونقل الخزنة (بين البي سي واللابتوب)
                  </h4>
                  <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
                    يمكنك تصدير الخزنة المشفرة كملف احتياطي (<bdi dir="ltr">.dat</bdi>) لنقلها إلى لابتوب أو فلاش <bdi dir="ltr">USB</bdi>، أو استيراد نسخة سابقة.
                  </p>
                </div>
              </div>

              {exportImportStatus && (
                <div
                  className={`p-4 rounded-xl text-sm font-semibold flex items-center justify-between gap-3 whitespace-pre-line ${
                    exportImportStatus.type === "success"
                      ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-400"
                      : "bg-destructive/15 border border-destructive/40 text-destructive-foreground"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {exportImportStatus.type === "success" ? (
                      <Check className="w-5 h-5 shrink-0" />
                    ) : (
                      <ShieldAlert className="w-5 h-5 shrink-0" />
                    )}
                    <span className="[overflow-wrap:anywhere]">{exportImportStatus.message}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => dismissExportImportStatus()}
                    className="h-8 w-8 p-0 rounded-lg hover:bg-white/10 shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </Button>
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
                  <span>تصدير نسخة احتياطية مشفرة (<bdi dir="ltr">.dat</bdi>)</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  disabled={isProcessingBackup}
                  onClick={handleOpenImportModal}
                  className="rounded-xl font-bold h-12 px-5 gap-2 border-border shadow-sm hover:bg-muted text-white"
                >
                  <Upload className="w-4 h-4 text-white" />
                  <span>استيراد خزنة من ملف (<bdi dir="ltr">.dat</bdi>)</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleOpenVaultFolder}
                  className="rounded-xl font-bold h-12 px-5 gap-2 border-border shadow-sm hover:bg-muted text-white"
                >
                  <FolderOpen className="w-4 h-4 text-white" />
                  <span>فتح مسار مجلد الخزنة</span>
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
      <Dialog
        open={showAutoUnlockModal}
        onOpenChange={(open) => {
          setShowAutoUnlockModal(open);
          if (!open) {
            setAutoUnlockPassword("");
            setShowAutoUnlockPassword(false);
            setAutoUnlockModalError(null);
          }
        }}
      >
        <DialogContent className="max-w-md p-6 sm:p-7 rounded-3xl bg-card border-2 border-border/80 shadow-2xl z-[70]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black font-thamaniah flex items-center gap-2.5 text-foreground text-start">
              <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <span>تفعيل الفتح التلقائي</span>
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground mt-2 leading-relaxed text-start">
              أدخل رمز الدخول (<bdi dir="ltr">PIN</bdi>) أو كلمة المرور الرئيسية ليتم حفظها وتشفيرها في مخزن الاعتمادات الآمن بالنظام (<bdi dir="ltr">{autoUnlockStatus.platform_name}</bdi>).
            </DialogDescription>
          </DialogHeader>

          {autoUnlockModalError && (
            <div className="p-3.5 rounded-xl bg-destructive/15 border border-destructive/30 text-destructive-foreground text-sm font-bold flex items-center gap-2.5 text-start">
              <ShieldAlert className="w-4 h-4 shrink-0 text-destructive" />
              <span>{autoUnlockModalError}</span>
            </div>
          )}

          <form onSubmit={handleConfirmEnableAutoUnlock} autoComplete="off" className="space-y-4 pt-2">
            <div>
              <FormLabel htmlFor="auto-unlock-password" required className="text-xs">
                أدخل رمز الدخول أو كلمة المرور الحالية
              </FormLabel>
              <SecretInput
                id="auto-unlock-password"
                revealed={showAutoUnlockPassword}
                onToggleReveal={() => setShowAutoUnlockPassword((prev) => !prev)}
                revealLabel="إظهار الرمز"
                hideLabel="إخفاء الرمز"
                centered
                codeStyleWhenFilled
                filledTrackingClass="tracking-widest"
                placeholder="أدخل الرمز..."
                value={autoUnlockPassword}
                onChange={(e) => {
                  setAutoUnlockPassword(e.target.value);
                  if (autoUnlockModalError) setAutoUnlockModalError(null);
                }}
                autoFocus
                className="text-base font-bold rounded-xl border-2"
                disabled={autoUnlockModalLoading}
                required
              />
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
      <Dialog
        open={showRecoveryModal}
        onOpenChange={(open) => {
          setShowRecoveryModal(open);
          if (!open) {
            setInputRecoveryKey("");
            setShowInputRecoveryKey(false);
          }
        }}
      >
        <DialogContent className="max-w-2xl p-8 rounded-3xl bg-card border-2 border-border/80 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-3xl font-black font-thamaniah flex items-center gap-3 text-start">
              <KeyRound className="w-7 h-7 text-primary shrink-0" />
              <span>استعادة الخزنة عبر مفتاح الطوارئ</span>
            </DialogTitle>
            <DialogDescription className="text-base text-muted-foreground pt-1 text-start">
              أدخل مفتاح الاسترداد الخاص بك (مثال: <bdi dir="ltr">KN-XXXX-XXXX-XXXX-XXXX</bdi>) لاستعادة الخزنة فوراً.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleRecoverVault} autoComplete="off" className="space-y-6 pt-4">
            <div>
              <FormLabel htmlFor="recovery-key-input" required className="mb-2">
                مفتاح الاسترداد (<bdi dir="ltr">Recovery Key</bdi>)
              </FormLabel>
              <SecretInput
                id="recovery-key-input"
                revealed={showInputRecoveryKey}
                onToggleReveal={() => setShowInputRecoveryKey((prev) => !prev)}
                revealLabel="إظهار مفتاح الاسترداد"
                hideLabel="إخفاء مفتاح الاسترداد"
                centered
                codeStyleWhenFilled
                filledTrackingClass="tracking-widest"
                placeholder="KN-XXXX-XXXX-XXXX-XXXX"
                value={inputRecoveryKey}
                onChange={(e) => setInputRecoveryKey(e.target.value)}
                className="min-h-14 text-lg sm:text-xl font-bold rounded-xl border-2"
                autoFocus
                required
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowRecoveryModal(false)}
                className="h-12 px-6 rounded-xl text-base font-bold"
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                className="h-12 px-8 rounded-xl text-base font-bold shadow-lg gap-2"
              >
                <Unlock className="w-5 h-5" />
                <span>استعادة وفتح الخزنة</span>
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ================= MODAL: IMPORT VAULT (CRYPTOGRAPHICALLY VERIFIED) ================= */}
      <Dialog
        open={showImportModal}
        onOpenChange={(open) => {
          setShowImportModal(open);
          if (!open) {
            setImportPassword("");
            setShowImportPassword(false);
            setImportModalError(null);
          }
        }}
      >
        <DialogContent className="max-w-xl p-8 rounded-3xl bg-card border-2 border-border/80 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black font-thamaniah flex items-center gap-3 text-start">
              <Upload className="w-6 h-6 text-primary shrink-0" />
              <span>استيراد واستبدال الخزنة</span>
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground pt-1 text-start">
              أدخل كلمة مرور ملف الخزنة المستوردة للتحقق التشفيري الكامل من سلامتها وفك تشفيرها قبل استبدال الملفات.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handlePerformImport} autoComplete="off" className="space-y-6 pt-4">
            {importModalError && (
              <div className="p-4 rounded-xl bg-destructive/15 border border-destructive/30 text-destructive text-sm font-bold flex items-center gap-2 text-start">
                <ShieldAlert className="w-5 h-5 flex-shrink-0" />
                <span>{importModalError}</span>
              </div>
            )}

            <div>
              <FormLabel htmlFor="import-vault-password" required className="text-sm mb-2">
                كلمة مرور الخزنة المستوردة
              </FormLabel>
              <SecretInput
                id="import-vault-password"
                revealed={showImportPassword}
                onToggleReveal={() => setShowImportPassword((prev) => !prev)}
                revealLabel="إظهار كلمة مرور الخزنة المستوردة"
                hideLabel="إخفاء كلمة مرور الخزنة المستوردة"
                placeholder="أدخل كلمة مرور ملف الخزنة..."
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
                className="text-base rounded-xl border-2"
                autoFocus
                required
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={isProcessingBackup}
                onClick={() => setShowImportModal(false)}
                className="h-12 px-6 rounded-xl font-bold"
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                disabled={isProcessingBackup}
                className="h-12 px-8 rounded-xl font-bold shadow-lg gap-2"
              >
                {isProcessingBackup ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>جارٍ التحقق والاستيراد...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    <span>اختيار الملف والاستيراد</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
