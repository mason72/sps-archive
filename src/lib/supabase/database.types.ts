export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          created_at: string
          event_id: string | null
          id: string
          image_id: string | null
          metadata: Json | null
          share_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          event_id?: string | null
          id?: string
          image_id?: string | null
          metadata?: Json | null
          share_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          event_id?: string | null
          id?: string
          image_id?: string | null
          metadata?: Json | null
          share_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "shares"
            referencedColumns: ["id"]
          },
        ]
      }
      allowed_signups: {
        Row: {
          email: string
          invited_at: string
          invited_by: string | null
          joined_at: string | null
          note: string | null
        }
        Insert: {
          email: string
          invited_at?: string
          invited_by?: string | null
          joined_at?: string | null
          note?: string | null
        }
        Update: {
          email?: string
          invited_at?: string
          invited_by?: string | null
          joined_at?: string | null
          note?: string | null
        }
        Relationships: []
      }
      auth_attempts: {
        Row: {
          attempts: number
          key: string
          window_start: string
        }
        Insert: {
          attempts?: number
          key: string
          window_start?: string
        }
        Update: {
          attempts?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      crew: {
        Row: {
          aliases: string[]
          archived: boolean
          can_lead: string | null
          city: string | null
          created_at: string
          display_name: string
          full_name: string | null
          id: string
          is_regular: boolean
          kind: string
          last_hired_on: string | null
          notes: string | null
          primary_email: string | null
          region: string | null
          rehire: string | null
          travels: boolean | null
          updated_at: string
          user_id: string
        }
        Insert: {
          aliases?: string[]
          archived?: boolean
          can_lead?: string | null
          city?: string | null
          created_at?: string
          display_name: string
          full_name?: string | null
          id?: string
          is_regular?: boolean
          kind?: string
          last_hired_on?: string | null
          notes?: string | null
          primary_email?: string | null
          region?: string | null
          rehire?: string | null
          travels?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          aliases?: string[]
          archived?: boolean
          can_lead?: string | null
          city?: string | null
          created_at?: string
          display_name?: string
          full_name?: string | null
          id?: string
          is_regular?: boolean
          kind?: string
          last_hired_on?: string | null
          notes?: string | null
          primary_email?: string | null
          region?: string | null
          rehire?: string | null
          travels?: boolean | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      crew_faces: {
        Row: {
          bbox: Json | null
          created_at: string
          crew_id: string
          embedding: string | null
          face_id: string | null
          id: string
          image_id: string | null
          is_avatar: boolean
          source: string
          storage_key: string | null
          user_id: string
        }
        Insert: {
          bbox?: Json | null
          created_at?: string
          crew_id: string
          embedding?: string | null
          face_id?: string | null
          id?: string
          image_id?: string | null
          is_avatar?: boolean
          source?: string
          storage_key?: string | null
          user_id: string
        }
        Update: {
          bbox?: Json | null
          created_at?: string
          crew_id?: string
          embedding?: string | null
          face_id?: string | null
          id?: string
          image_id?: string | null
          is_avatar?: boolean
          source?: string
          storage_key?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_faces_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crew"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_faces_face_id_fkey"
            columns: ["face_id"]
            isOneToOne: false
            referencedRelation: "faces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_faces_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_persons: {
        Row: {
          confirmed_by: string
          created_at: string
          crew_id: string
          person_id: string
          user_id: string
        }
        Insert: {
          confirmed_by?: string
          created_at?: string
          crew_id: string
          person_id: string
          user_id: string
        }
        Update: {
          confirmed_by?: string
          created_at?: string
          crew_id?: string
          person_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crew_persons_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crew"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crew_persons_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      crew_roles: {
        Row: {
          created_at: string
          id: string
          name: string
          sort_order: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: []
      }
      email_sends: {
        Row: {
          body_html: string
          event_id: string | null
          id: string
          recipients: Json
          sent_at: string
          status: string
          subject: string
          template_id: string | null
          user_id: string
        }
        Insert: {
          body_html?: string
          event_id?: string | null
          id?: string
          recipients?: Json
          sent_at?: string
          status?: string
          subject: string
          template_id?: string | null
          user_id: string
        }
        Update: {
          body_html?: string
          event_id?: string | null
          id?: string
          recipients?: Json
          sent_at?: string
          status?: string
          subject?: string
          template_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sends_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sends_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body_html: string
          created_at: string
          id: string
          is_default: boolean
          name: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body_html?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          subject?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body_html?: string
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      event_crew: {
        Row: {
          confirmed_roles: string[]
          created_at: string
          crew_id: string
          event_id: string
          note: string | null
          roles: string[]
          roles_source: string
          user_id: string
          would_rebook: string | null
        }
        Insert: {
          confirmed_roles?: string[]
          created_at?: string
          crew_id: string
          event_id: string
          note?: string | null
          roles?: string[]
          roles_source?: string
          user_id: string
          would_rebook?: string | null
        }
        Update: {
          confirmed_roles?: string[]
          created_at?: string
          crew_id?: string
          event_id?: string
          note?: string | null
          roles?: string[]
          roles_source?: string
          user_id?: string
          would_rebook?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_crew_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crew"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_crew_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_intel: {
        Row: {
          calendar_event_ids: string[]
          confirmed_at: string | null
          created_at: string
          event_id: string
          notes: string | null
          source: string
          updated_at: string
          user_id: string
          venue_id: string | null
        }
        Insert: {
          calendar_event_ids?: string[]
          confirmed_at?: string | null
          created_at?: string
          event_id: string
          notes?: string | null
          source?: string
          updated_at?: string
          user_id: string
          venue_id?: string | null
        }
        Update: {
          calendar_event_ids?: string[]
          confirmed_at?: string | null
          created_at?: string
          event_id?: string
          notes?: string | null
          source?: string
          updated_at?: string
          user_id?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_intel_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_intel_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      event_orgs: {
        Row: {
          created_at: string
          event_id: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          org_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_orgs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_orgs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      event_templates: {
        Row: {
          created_at: string | null
          description: string | null
          event_type: string | null
          id: string
          name: string
          sections: Json | null
          settings: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          event_type?: string | null
          id?: string
          name: string
          sections?: Json | null
          settings?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          event_type?: string | null
          id?: string
          name?: string
          sections?: Json | null
          settings?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          city: string | null
          cover_image_id: string | null
          created_at: string
          description: string | null
          event_date: string | null
          event_type: string | null
          id: string
          name: string
          pinned_at: string | null
          settings: Json
          slug: string
          sort_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          city?: string | null
          cover_image_id?: string | null
          created_at?: string
          description?: string | null
          event_date?: string | null
          event_type?: string | null
          id?: string
          name: string
          pinned_at?: string | null
          settings?: Json
          slug: string
          sort_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          city?: string | null
          cover_image_id?: string | null
          created_at?: string
          description?: string | null
          event_date?: string | null
          event_type?: string | null
          id?: string
          name?: string
          pinned_at?: string | null
          settings?: Json
          slug?: string
          sort_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_events_cover_image"
            columns: ["cover_image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
        ]
      }
      excluded_people: {
        Row: {
          created_at: string
          name: string | null
          person_key: string
          reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          name?: string | null
          person_key: string
          reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          name?: string | null
          person_key?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      faces: {
        Row: {
          bbox_h: number
          bbox_w: number
          bbox_x: number
          bbox_y: number
          confidence: number | null
          created_at: string
          embedding: string | null
          id: string
          image_id: string
          is_eyes_open: boolean | null
          person_id: string | null
          quality: number | null
        }
        Insert: {
          bbox_h: number
          bbox_w: number
          bbox_x: number
          bbox_y: number
          confidence?: number | null
          created_at?: string
          embedding?: string | null
          id?: string
          image_id: string
          is_eyes_open?: boolean | null
          person_id?: string | null
          quality?: number | null
        }
        Update: {
          bbox_h?: number
          bbox_w?: number
          bbox_x?: number
          bbox_y?: number
          confidence?: number | null
          created_at?: string
          embedding?: string | null
          id?: string
          image_id?: string
          is_eyes_open?: boolean | null
          person_id?: string | null
          quality?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "faces_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_faces_person"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          client_email: string | null
          client_name: string | null
          created_at: string
          id: string
          image_id: string
          share_id: string
        }
        Insert: {
          client_email?: string | null
          client_name?: string | null
          created_at?: string
          id?: string
          image_id: string
          share_id: string
        }
        Update: {
          client_email?: string | null
          client_name?: string | null
          created_at?: string
          id?: string
          image_id?: string
          share_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "shares"
            referencedColumns: ["id"]
          },
        ]
      }
      images: {
        Row: {
          aesthetic_score: number | null
          ai_indexed_at: string | null
          aperture: number | null
          camera_make: string | null
          camera_model: string | null
          created_at: string
          display_order: number
          dominant_color: string | null
          duration_seconds: number | null
          embedding_model: string | null
          event_id: string
          featured: boolean
          file_size: number
          filename: string
          focal_length: number | null
          focal_x: number | null
          focal_y: number | null
          gps_lat: number | null
          gps_lng: number | null
          has_audio: boolean | null
          height: number | null
          id: string
          is_eyes_open: boolean | null
          iso: number | null
          last_error: string | null
          lens: string | null
          media_type: string
          mime_type: string
          original_filename: string
          parsed_name: string | null
          processing_error: string | null
          processing_status: string
          r2_key: string
          scene_tags: string[] | null
          service: string | null
          sharpness_score: number | null
          shutter_speed: string | null
          siglip_embedding: string | null
          site_published_at: string | null
          site_scene: string | null
          sps_image_id: string | null
          sps_pulled_at: string | null
          sps_quality: string | null
          stack_id: string | null
          stack_rank: number | null
          starred: boolean
          stream_uid: string | null
          taken_at: string | null
          thumb_bytes: number | null
          thumbnail_generated: boolean | null
          updated_at: string
          width: number | null
        }
        Insert: {
          aesthetic_score?: number | null
          ai_indexed_at?: string | null
          aperture?: number | null
          camera_make?: string | null
          camera_model?: string | null
          created_at?: string
          display_order?: number
          dominant_color?: string | null
          duration_seconds?: number | null
          embedding_model?: string | null
          event_id: string
          featured?: boolean
          file_size: number
          filename: string
          focal_length?: number | null
          focal_x?: number | null
          focal_y?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          has_audio?: boolean | null
          height?: number | null
          id?: string
          is_eyes_open?: boolean | null
          iso?: number | null
          last_error?: string | null
          lens?: string | null
          media_type?: string
          mime_type: string
          original_filename: string
          parsed_name?: string | null
          processing_error?: string | null
          processing_status?: string
          r2_key: string
          scene_tags?: string[] | null
          service?: string | null
          sharpness_score?: number | null
          shutter_speed?: string | null
          siglip_embedding?: string | null
          site_published_at?: string | null
          site_scene?: string | null
          sps_image_id?: string | null
          sps_pulled_at?: string | null
          sps_quality?: string | null
          stack_id?: string | null
          stack_rank?: number | null
          starred?: boolean
          stream_uid?: string | null
          taken_at?: string | null
          thumb_bytes?: number | null
          thumbnail_generated?: boolean | null
          updated_at?: string
          width?: number | null
        }
        Update: {
          aesthetic_score?: number | null
          ai_indexed_at?: string | null
          aperture?: number | null
          camera_make?: string | null
          camera_model?: string | null
          created_at?: string
          display_order?: number
          dominant_color?: string | null
          duration_seconds?: number | null
          embedding_model?: string | null
          event_id?: string
          featured?: boolean
          file_size?: number
          filename?: string
          focal_length?: number | null
          focal_x?: number | null
          focal_y?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          has_audio?: boolean | null
          height?: number | null
          id?: string
          is_eyes_open?: boolean | null
          iso?: number | null
          last_error?: string | null
          lens?: string | null
          media_type?: string
          mime_type?: string
          original_filename?: string
          parsed_name?: string | null
          processing_error?: string | null
          processing_status?: string
          r2_key?: string
          scene_tags?: string[] | null
          service?: string | null
          sharpness_score?: number | null
          shutter_speed?: string | null
          siglip_embedding?: string | null
          site_published_at?: string | null
          site_scene?: string | null
          sps_image_id?: string | null
          sps_pulled_at?: string | null
          sps_quality?: string | null
          stack_id?: string | null
          stack_rank?: number | null
          starred?: boolean
          stream_uid?: string | null
          taken_at?: string | null
          thumb_bytes?: number | null
          thumbnail_generated?: boolean | null
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_images_stack"
            columns: ["stack_id"]
            isOneToOne: false
            referencedRelation: "stacks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "images_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      organizations: {
        Row: {
          created_at: string
          domains: string[]
          id: string
          kind: string
          name: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          domains?: string[]
          id?: string
          kind?: string
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          domains?: string[]
          id?: string
          kind?: string
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      person_aliases: {
        Row: {
          alias_key: string
          alias_name: string
          canonical_key: string
          canonical_name: string
          created_at: string
          user_id: string
        }
        Insert: {
          alias_key: string
          alias_name: string
          canonical_key: string
          canonical_name: string
          created_at?: string
          user_id: string
        }
        Update: {
          alias_key?: string
          alias_name?: string
          canonical_key?: string
          canonical_name?: string
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      person_identity_suggestions: {
        Row: {
          confidence: number
          created_at: string
          decided_at: string | null
          event_id: string
          id: string
          matched_person_id: string | null
          person_id: string
          photo_count: number
          status: string
          suggested_key: string
          suggested_name: string
          user_id: string
        }
        Insert: {
          confidence: number
          created_at?: string
          decided_at?: string | null
          event_id: string
          id?: string
          matched_person_id?: string | null
          person_id: string
          photo_count?: number
          status?: string
          suggested_key: string
          suggested_name: string
          user_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          decided_at?: string | null
          event_id?: string
          id?: string
          matched_person_id?: string | null
          person_id?: string
          photo_count?: number
          status?: string
          suggested_key?: string
          suggested_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_identity_suggestions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_identity_suggestions_matched_person_id_fkey"
            columns: ["matched_person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_identity_suggestions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      person_reference_centroids: {
        Row: {
          centroid: string
          face_count: number
          name: string
          name_key: string
          person_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          centroid: string
          face_count: number
          name: string
          name_key: string
          person_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          centroid?: string
          face_count?: number
          name?: string
          name_key?: string
          person_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_reference_centroids_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      persons: {
        Row: {
          created_at: string
          event_id: string
          face_count: number
          id: string
          name: string | null
          rejected_names: string[]
          representative_face_id: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          face_count?: number
          id?: string
          name?: string | null
          rejected_names?: string[]
          representative_face_id?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          face_count?: number
          id?: string
          name?: string | null
          rejected_names?: string[]
          representative_face_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "persons_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      section_images: {
        Row: {
          image_id: string
          relevance_score: number | null
          section_id: string
          sort_order: number
        }
        Insert: {
          image_id: string
          relevance_score?: number | null
          section_id: string
          sort_order?: number
        }
        Update: {
          image_id?: string
          relevance_score?: number | null
          section_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "section_images_image_id_fkey"
            columns: ["image_id"]
            isOneToOne: false
            referencedRelation: "images"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "section_images_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      sections: {
        Row: {
          created_at: string
          description: string | null
          event_id: string
          filter_query: string | null
          id: string
          is_auto: boolean
          job_meta: Json | null
          locked: boolean
          name: string
          site_scene_key: string | null
          sort_mode: string | null
          sort_order: number
          sort_seed: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_id: string
          filter_query?: string | null
          id?: string
          is_auto?: boolean
          job_meta?: Json | null
          locked?: boolean
          name: string
          site_scene_key?: string | null
          sort_mode?: string | null
          sort_order?: number
          sort_seed?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          event_id?: string
          filter_query?: string | null
          id?: string
          is_auto?: boolean
          job_meta?: Json | null
          locked?: boolean
          name?: string
          site_scene_key?: string | null
          sort_mode?: string | null
          sort_order?: number
          sort_seed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sections_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      shares: {
        Row: {
          allow_download: boolean
          allow_favorites: boolean
          created_at: string
          custom_message: string | null
          digested_at: string | null
          download_pin: string | null
          download_quality: string
          event_id: string
          expires_at: string | null
          id: string
          image_ids: string[] | null
          is_active: boolean
          last_viewed_at: string | null
          password_hash: string | null
          person_id: string | null
          pin: string | null
          require_pin_bulk: boolean | null
          require_pin_individual: boolean | null
          section_id: string | null
          share_type: string
          slug: string
          view_count: number
        }
        Insert: {
          allow_download?: boolean
          allow_favorites?: boolean
          created_at?: string
          custom_message?: string | null
          digested_at?: string | null
          download_pin?: string | null
          download_quality?: string
          event_id: string
          expires_at?: string | null
          id?: string
          image_ids?: string[] | null
          is_active?: boolean
          last_viewed_at?: string | null
          password_hash?: string | null
          person_id?: string | null
          pin?: string | null
          require_pin_bulk?: boolean | null
          require_pin_individual?: boolean | null
          section_id?: string | null
          share_type?: string
          slug: string
          view_count?: number
        }
        Update: {
          allow_download?: boolean
          allow_favorites?: boolean
          created_at?: string
          custom_message?: string | null
          digested_at?: string | null
          download_pin?: string | null
          download_quality?: string
          event_id?: string
          expires_at?: string | null
          id?: string
          image_ids?: string[] | null
          is_active?: boolean
          last_viewed_at?: string | null
          password_hash?: string | null
          person_id?: string | null
          pin?: string | null
          require_pin_bulk?: boolean | null
          require_pin_individual?: boolean | null
          section_id?: string | null
          share_type?: string
          slug?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "shares_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shares_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shares_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "sections"
            referencedColumns: ["id"]
          },
        ]
      }
      sps_connections: {
        Row: {
          connected_at: string
          last_pull_at: string | null
          token: string
          token_prefix: string
          user_id: string
        }
        Insert: {
          connected_at?: string
          last_pull_at?: string | null
          token: string
          token_prefix: string
          user_id: string
        }
        Update: {
          connected_at?: string
          last_pull_at?: string | null
          token?: string
          token_prefix?: string
          user_id?: string
        }
        Relationships: []
      }
      sps_pull_jobs: {
        Row: {
          bytes_copied: number
          confirmed: number
          created_at: string
          deselected: string[]
          error: string | null
          event_id: string
          expected_total: number | null
          failures: Json
          finished_at: string | null
          id: string
          images_done: number
          images_failed: number
          images_skipped: number
          next_offset: number
          sps_event_id: string
          sps_event_name: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bytes_copied?: number
          confirmed?: number
          created_at?: string
          deselected?: string[]
          error?: string | null
          event_id: string
          expected_total?: number | null
          failures?: Json
          finished_at?: string | null
          id?: string
          images_done?: number
          images_failed?: number
          images_skipped?: number
          next_offset?: number
          sps_event_id: string
          sps_event_name?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bytes_copied?: number
          confirmed?: number
          created_at?: string
          deselected?: string[]
          error?: string | null
          event_id?: string
          expected_total?: number | null
          failures?: Json
          finished_at?: string | null
          id?: string
          images_done?: number
          images_failed?: number
          images_skipped?: number
          next_offset?: number
          sps_event_id?: string
          sps_event_name?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sps_pull_jobs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      stacks: {
        Row: {
          cover_image_id: string | null
          created_at: string
          event_id: string
          id: string
          image_count: number
          person_id: string | null
          stack_type: string
        }
        Insert: {
          cover_image_id?: string | null
          created_at?: string
          event_id: string
          id?: string
          image_count?: number
          person_id?: string | null
          stack_type?: string
        }
        Update: {
          cover_image_id?: string | null
          created_at?: string
          event_id?: string
          id?: string
          image_count?: number
          person_id?: string | null
          stack_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "stacks_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stacks_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          event_id: string
          event_type: string
          received_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          received_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          received_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          billing_interval: string | null
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          billing_interval?: string | null
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          billing_interval?: string | null
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      system_errors: {
        Row: {
          context: string
          created_at: string
          detail: Json | null
          event_id: string | null
          id: string
          message: string
          notified: boolean
          user_id: string | null
        }
        Insert: {
          context: string
          created_at?: string
          detail?: Json | null
          event_id?: string | null
          id?: string
          message: string
          notified?: boolean
          user_id?: string | null
        }
        Update: {
          context?: string
          created_at?: string
          detail?: Json | null
          event_id?: string | null
          id?: string
          message?: string
          notified?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_errors_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          created_at: string
          event_id: string | null
          id: string
          kind: string
          metadata: Json | null
          quantity: number
          unit: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          id?: string
          kind: string
          metadata?: Json | null
          quantity: number
          unit: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string | null
          id?: string
          kind?: string
          metadata?: Json | null
          quantity?: number
          unit?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          bio: string | null
          branding: Json
          business_name: string | null
          created_at: string
          display_name: string | null
          gallery_defaults: Json
          is_admin: boolean
          location: string | null
          logo_url: string | null
          phone: string | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          bio?: string | null
          branding?: Json
          business_name?: string | null
          created_at?: string
          display_name?: string | null
          gallery_defaults?: Json
          is_admin?: boolean
          location?: string | null
          logo_url?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          bio?: string | null
          branding?: Json
          business_name?: string | null
          created_at?: string
          display_name?: string | null
          gallery_defaults?: Json
          is_admin?: boolean
          location?: string | null
          logo_url?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      venue_notes: {
        Row: {
          body: string
          created_at: string
          event_id: string | null
          id: string
          user_id: string
          venue_id: string
        }
        Insert: {
          body: string
          created_at?: string
          event_id?: string | null
          id?: string
          user_id: string
          venue_id: string
        }
        Update: {
          body?: string
          created_at?: string
          event_id?: string | null
          id?: string
          user_id?: string
          venue_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venue_notes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venue_notes_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      venues: {
        Row: {
          address: string | null
          city: string | null
          country: string | null
          created_at: string
          id: string
          lat: number | null
          lng: number | null
          name: string
          notes: string | null
          place_id: string | null
          region: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          name: string
          notes?: string | null
          place_id?: string | null
          region?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          id?: string
          lat?: number | null
          lng?: number | null
          name?: string
          notes?: string | null
          place_id?: string | null
          region?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          reviewed_at: string | null
          status: string
          work_url: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          reviewed_at?: string | null
          status?: string
          work_url?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          reviewed_at?: string | null
          status?: string
          work_url?: string | null
        }
        Relationships: []
      }
      zip_jobs: {
        Row: {
          created_at: string
          error: string | null
          expires_at: string | null
          id: string
          image_count: number | null
          images_done: number
          r2_key: string | null
          ready_at: string | null
          scope: Json
          scope_key: string
          share_id: string
          size_bytes: number | null
          status: string
          zip_filename: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          expires_at?: string | null
          id?: string
          image_count?: number | null
          images_done?: number
          r2_key?: string | null
          ready_at?: string | null
          scope?: Json
          scope_key: string
          share_id: string
          size_bytes?: number | null
          status?: string
          zip_filename: string
        }
        Update: {
          created_at?: string
          error?: string | null
          expires_at?: string | null
          id?: string
          image_count?: number | null
          images_done?: number
          r2_key?: string | null
          ready_at?: string | null
          scope?: Json
          scope_key?: string
          share_id?: string
          size_bytes?: number | null
          status?: string
          zip_filename?: string
        }
        Relationships: [
          {
            foreignKeyName: "zip_jobs_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "shares"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_section_at_top: {
        Args: { p_description?: string; p_event_id: string; p_name: string }
        Returns: {
          created_at: string
          description: string | null
          event_id: string
          filter_query: string | null
          id: string
          is_auto: boolean
          job_meta: Json | null
          locked: boolean
          name: string
          site_scene_key: string | null
          sort_mode: string | null
          sort_order: number
          sort_seed: number | null
        }
        SetofOptions: {
          from: "*"
          to: "sections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      database_footprint: {
        Args: never
        Returns: {
          db_bytes: number
          faces_indexed: number
          other_index_bytes: number
          photos_indexed: number
          photos_last_30d: number
          photos_last_90d: number
          table_bytes: number
          vector_index_bytes: number
        }[]
      }
      delivery_rank: {
        Args: { e: Database["public"]["Tables"]["events"]["Row"] }
        Returns: number
      }
      delivery_stage: {
        Args: { e: Database["public"]["Tables"]["events"]["Row"] }
        Returns: string
      }
      event_image_status_counts: {
        Args: { p_event_id: string }
        Returns: {
          complete: number
          failed: number
          pending: number
          processing: number
          total: number
        }[]
      }
      event_readiness: {
        Args: { p_event_ids: string[] }
        Returns: {
          all_rows: number
          event_id: string
          indexed: number
          stalled: number
          total: number
          uploading: number
        }[]
      }
      events_needing_ai_index: {
        Args: { max_events?: number }
        Returns: {
          event_id: string
          oldest: string
          pending: number
        }[]
      }
      first_image_per_event: {
        Args: { p_event_ids: string[] }
        Returns: {
          event_id: string
          focal_x: number
          focal_y: number
          r2_key: string
        }[]
      }
      get_activity_totals: { Args: { p_user_id: string }; Returns: Json }
      get_daily_activity: {
        Args: { p_days?: number; p_user_id: string }
        Returns: {
          action: string
          day: string
          total: number
        }[]
      }
      get_user_storage: {
        Args: { p_user_id: string }
        Returns: {
          original_bytes: number
          thumb_bytes: number
          unmeasured_original_bytes: number
          zip_bytes: number
        }[]
      }
      increment_share_views: {
        Args: { p_share_id: string }
        Returns: undefined
      }
      match_person_cluster: {
        Args: { p_limit?: number; p_person_id: string }
        Returns: {
          face_count: number
          matched_person_id: string
          name: string
          name_key: string
          similarity: number
        }[]
      }
      record_auth_attempt: {
        Args: { p_key: string; p_max: number; p_window_seconds: number }
        Returns: boolean
      }
      refresh_person_reference_centroids: {
        Args: { p_event_id?: string; p_user_id: string }
        Returns: number
      }
      reorder_sections: {
        Args: { p_event_id: string; p_section_ids: string[] }
        Returns: undefined
      }
      resolve_share_by_slug: {
        Args: { p_slug: string }
        Returns: {
          allow_download: boolean
          allow_favorites: boolean
          custom_message: string
          event_id: string
          expires_at: string
          has_password: boolean
          id: string
          image_ids: string[]
          is_active: boolean
          person_id: string
          require_pin_bulk: boolean
          require_pin_individual: boolean
          section_id: string
          share_type: string
        }[]
      }
      score_images_by_embedding: {
        Args: {
          query_embedding: string
          target_event_id: string
          target_user_id: string
        }
        Returns: {
          id: string
          similarity: number
        }[]
      }
      search_faces_by_embedding: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
          target_event_id?: string
          target_user_id: string
        }
        Returns: {
          face_id: string
          image_id: string
          person_id: string
          similarity: number
        }[]
      }
      search_images_by_embedding: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
          target_event_id?: string
          target_user_id: string
        }
        Returns: {
          event_id: string
          filename: string
          id: string
          original_filename: string
          r2_key: string
          similarity: number
        }[]
      }
      set_stack_cover: {
        Args: { p_image_id: string; p_stack_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
