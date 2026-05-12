export function determineSections(userSections, aiDetectedSections) {
  // If the user explicitly provided sections in the Design Manifest GUI,
  // we enforce them as the structural backbone.
  if (userSections && Array.isArray(userSections) && userSections.length > 0) {
    console.log('[Section Detection] Using user-provided sections:', userSections);
    return userSections;
  }
  
  // Otherwise, fallback to the sections detected natively from the website screenshot
  if (aiDetectedSections && Array.isArray(aiDetectedSections) && aiDetectedSections.length > 0) {
    console.log('[Section Detection] Using AI-detected sections:', aiDetectedSections);
    return aiDetectedSections;
  }
  
  // Failsafe default
  return ["Hero", "Features", "CTA", "Footer"];
}
