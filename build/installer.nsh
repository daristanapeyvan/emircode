; ==============================================================================
; Emir Code - Custom NSIS Configuration for High-DPI Display Scaling
; ==============================================================================
; Setting ManifestDPIAware to true informs Windows that the installer is DPI-aware.
; This disables legacy DWM bitmap virtualization and ensures crisp font rendering
; on High-DPI screens (e.g. 125%, 150%, 175%, 200% display scaling).
ManifestDPIAware true
