// AIDEV-NOTE: Single application icon system (Phosphor). Import icons from here so
// weight and sizing stay consistent and swaps happen in one place. The `/ssr` subpath
// is the App Router-safe entry — icons render on the server with no client-only flash.
// Regular weight is the navigation default; use bold/fill only for selected states.
export {
  // Navigation — meeting access
  SquaresFourIcon as DashboardIcon,
  CircleIcon as MeetingsIcon,
  CheckCircleIcon as ReviewIcon,
  ArrowBendUpLeftIcon as DeferIcon,
  PenNibIcon as SigningIcon,
  ArchiveIcon as ArchiveIcon,
  // Navigation — association
  CurrencyDollarIcon as FinancialsIcon,
  HouseIcon as PropertiesIcon,
  DiamondIcon as VendorsIcon,
  AtIcon as ContactsIcon,
  // Navigation — administration & shell
  UsersThreeIcon as AccountsIcon,
  GearIcon as SettingsIcon,
  MoonStarsIcon as DarkModeIcon,
  SunIcon as LightModeIcon,
  UploadSimpleIcon as UploadIcon,
  ListIcon as MenuIcon,
  MagnifyingGlassIcon as SearchIcon,
  CaretDownIcon as CaretDownIcon,
  // Status & operations
  WarningIcon as ExceptionIcon,
  ArrowClockwiseIcon as RetryIcon,
  FileTextIcon as DocumentIcon,
} from "@phosphor-icons/react/dist/ssr"

export type { Icon as PhosphorIcon } from "@phosphor-icons/react"
