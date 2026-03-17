import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { type InsertSession, type InsertViolation, type InsertViolationType } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

// ============================================
// SESSIONS
// ============================================

export function useCreateSession() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: InsertSession) => {
      const res = await fetch(api.sessions.create.path, {
        method: api.sessions.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to start session");
      return api.sessions.create.responses[201].parse(await res.json());
    },
    onError: (error) => {
      toast({
        title: "Error starting session",
        description: error.message,
        variant: "destructive",
      });
    }
  });
}

export function useSession(id: number) {
  return useQuery({
    queryKey: [api.sessions.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.sessions.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch session");
      return api.sessions.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

export function useEndSession() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, endTime }: { id: number, endTime: string }) => {
      const url = buildUrl(api.sessions.end.path, { id });
      const res = await fetch(url, {
        method: api.sessions.end.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endTime }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to end session");
      return api.sessions.end.responses[200].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.sessions.get.path, variables.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
    },
    onError: (error) => {
      toast({
        title: "Error ending session",
        description: error.message,
        variant: "destructive",
      });
    }
  });
}

export function useUpdateSession() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, data }: { id: number, data: { busNumber?: string, driverName?: string, route?: string, stopBoarded?: string, startTime?: string } }) => {
      const url = buildUrl(api.sessions.update.path, { id });
      const res = await fetch(url, {
        method: api.sessions.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update session");
      return api.sessions.update.responses[200].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.sessions.get.path, variables.id] });
      toast({
        title: "Session Updated",
        description: "Session details have been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error updating session",
        description: error.message,
        variant: "destructive",
      });
    }
  });
}

export function useGenerateReport() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (sessionId: number) => {
      const username = localStorage.getItem("username") || "";
      let url = buildUrl(api.reports.generate.path, { id: sessionId });
      if (username) {
        url += `?username=${encodeURIComponent(username)}`;
      }
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to generate report");
      return api.reports.generate.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      // Trigger download
      const blob = new Blob([data.content], { type: "text/plain" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      // Invalidate sessions query so Reports page has fresh data
      queryClient.invalidateQueries({ queryKey: ["/api/sessions"] });
      
      toast({
        title: "Report Generated",
        description: "Your session report has been downloaded.",
      });
    },
    onError: (error) => {
      toast({
        title: "Report Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });
}

// ============================================
// VIOLATIONS
// ============================================

export function useViolations(sessionId: number) {
  return useQuery({
    queryKey: [api.violations.list.path, sessionId],
    queryFn: async () => {
      const url = buildUrl(api.violations.list.path, { sessionId });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch violations");
      return api.violations.list.responses[200].parse(await res.json());
    },
    enabled: !!sessionId,
  });
}

export function useCreateViolation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertViolation) => {
      // Ensure timestamp is properly formatted for the API/DB
      const payload = {
        ...data,
        timestamp: data.timestamp instanceof Date ? data.timestamp.toISOString() : data.timestamp
      };
      
      const res = await fetch(api.violations.create.path, {
        method: api.violations.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to log violation");
      return api.violations.create.responses[201].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.violations.list.path, variables.sessionId] });
      queryClient.invalidateQueries({ queryKey: [api.sessions.get.path, variables.sessionId] }); // Update session stats if needed
      toast({
        title: "Violation Logged",
        description: "Added to session log.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  });
}

export function useDeleteViolation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, sessionId }: { id: number, sessionId: number }) => {
      const url = buildUrl(api.violations.delete.path, { id });
      const res = await fetch(url, { method: api.violations.delete.method, credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete violation");
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.violations.list.path, variables.sessionId] });
      toast({
        title: "Removed",
        description: "Violation removed from log.",
      });
    }
  });
}

// ============================================
// VIOLATION TYPES
// ============================================

export function useViolationTypes() {
  return useQuery({
    queryKey: [api.violationTypes.list.path],
    queryFn: async () => {
      const res = await fetch(api.violationTypes.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch types");
      return api.violationTypes.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateViolationType() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertViolationType) => {
      const res = await fetch(api.violationTypes.create.path, {
        method: api.violationTypes.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to create type");
      return api.violationTypes.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.violationTypes.list.path] });
      toast({
        title: "Success",
        description: "New violation type added.",
      });
    }
  });
}
