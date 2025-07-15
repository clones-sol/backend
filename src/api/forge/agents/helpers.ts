import { encrypt } from '../../../services/security/crypto.ts';

export const INITIAL_AGENT_VERSION = 'v1.0';

/**
 * Creates a sanitized copy of agent data for logging purposes, redacting sensitive fields.
 * @param data The raw data object from the request body.
 * @returns A sanitized data object.
 */
export const sanitizeAgentDataForLogging = (data: any) => {
    const sanitized = JSON.parse(JSON.stringify(data));
    if (sanitized.deployment?.huggingFaceApiKey) {
        sanitized.deployment.huggingFaceApiKey = '[REDACTED]';
    }
    if (sanitized.huggingFaceApiKey) {
        sanitized.huggingFaceApiKey = '[REDACTED]';
    }
    return sanitized;
};

/**
 * Sanitizes state machine event data for logging purposes.
 * @param event The event object from the state machine.
 * @returns A sanitized event object.
 */
export const sanitizeEventForLogging = (event: any) => {
    if (!event) return event;
    const sanitized = { ...event };

    if (sanitized.data) {
        const sanitizedData = { ...sanitized.data };
        if (sanitizedData.txHash) sanitizedData.txHash = '[REDACTED]';
        if (sanitizedData.tokenAddress) sanitizedData.tokenAddress = '[REDACTED]';
        if (sanitizedData.poolAddress) sanitizedData.poolAddress = '[REDACTED]';
        sanitized.data = sanitizedData;
    }

    return sanitized;
};

/**
 * Creates the initial deployment version object if deployment data is provided.
 * @param deploymentData The deployment data from the request.
 * @returns A DeploymentVersion object or undefined.
 */
export const createFirstDeploymentVersion = (deploymentData?: { customUrl?: string; huggingFaceApiKey?: string }) => {
    if (!deploymentData || (!deploymentData.customUrl && !deploymentData.huggingFaceApiKey)) {
        return undefined;
    }

    return {
        versionTag: INITIAL_AGENT_VERSION,
        status: 'active' as const,
        createdAt: new Date(),
        customUrl: deploymentData.customUrl,
        encryptedApiKey: deploymentData.huggingFaceApiKey ? encrypt(deploymentData.huggingFaceApiKey) : undefined,
    };
}; 